'use strict';

// What plays on Windows, from one long-running Windows PowerShell (part of every Windows
// 10 and 11, so nothing extra ships): the system media session (the same list as the
// volume overlay: Spotify, Media Player, browsers, any player that reports to Windows), the
// running Steam game from HKCU\Software\Valve\Steam, and which of the known game processes
// run. It prints one JSON line every few seconds; a cover goes along only when the track
// changes. The script is passed inline: PowerShell can't read a file inside the app's asar.

const { spawn } = require('child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$known = @(KNOWN_GAMES)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); if ($t.Wait(3000)) { $t.Result } else { $null } }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
$mgr = Await ($mgrType::RequestAsync()) $mgrType
$sentCover = @{}
while ($true) {
  $media = @()
  if ($mgr) {
    foreach ($s in $mgr.GetSessions()) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) $propsType
      if (-not $p -or -not $p.Title) { continue }
      $info = $s.GetPlaybackInfo()
      $tl = $s.GetTimelineProperties()
      $status = [string]$info.PlaybackStatus
      $app = [string]$s.SourceAppUserModelId
      $key = $app + '|' + $p.Title + '|' + $p.Artist + '|' + $p.AlbumTitle
      $cover = $null
      if ($p.Thumbnail -and $sentCover[$app] -ne $key) {
        $st = Await ($p.Thumbnail.OpenReadAsync()) $streamType
        if ($st -and $st.Size -gt 0 -and $st.Size -lt 4MB) {
          $reader = [Windows.Storage.Streams.DataReader]::new($st)
          $null = Await ($reader.LoadAsync([uint32]$st.Size)) ([uint32])
          $bytes = New-Object byte[] ([int]$st.Size)
          $reader.ReadBytes($bytes)
          $cover = [Convert]::ToBase64String($bytes)
          $reader.Dispose(); $st.Dispose()
        }
        $sentCover[$app] = $key
      }
      $pos = $tl.Position.TotalMilliseconds
      if ($status -eq 'Playing' -and $tl.LastUpdatedTime.Year -gt 2000) { $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalMilliseconds }
      $media += @{ app = $app; key = $key; title = [string]$p.Title; artist = [string]$p.Artist; album = [string]$p.AlbumTitle; status = $status; positionMs = [int64]$pos; durationMs = [int64]$tl.EndTime.TotalMilliseconds; cover = $cover }
    }
  }
  $procs = @(Get-Process | Where-Object { $known -contains $_.ProcessName.ToLower() } | ForEach-Object { @{ name = $_.ProcessName.ToLower(); path = [string]$_.Path } })
  $steam = Get-ItemProperty -Path 'HKCU:\Software\Valve\Steam'
  $out = @{ media = $media; procs = $procs; steam = @{ appId = [int]$steam.RunningAppID; steamPath = [string]$steam.SteamPath } }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Depth 5 -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Seconds 4
}
`;

/** Apps whose sessions are browser tabs (Firefox registers under a hash). */
const BROWSERS = /chrome|msedge|firefox|brave|opera|vivaldi|librewolf|floorp|zen|308046B0AF4A39CB/i;

/** A display name for the app behind a media session: "Spotify.exe" -> "Spotify". */
function playerName(app) {
    if (/ZuneMusic/i.test(app)) return 'Media Player';
    const base = app.split('!').pop().split('\\').pop().replace(/\.exe$/i, '');
    const name = base.split('.').pop() || base;
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Starts the script; `onSnapshot` gets { media, procs, steam } every few seconds. `knownGames`
 * are the lowercased process names to look for. Returns a stop function.
 */
function startWindowsWatch(knownGames, onSnapshot) {
    const list = knownGames.map(n => `'${n.replace(/'/g, "''")}'`).join(', ');
    const encoded = Buffer.from(SCRIPT.replace('KNOWN_GAMES', list), 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            try {
                const snap = JSON.parse(line);
                const media = (Array.isArray(snap.media) ? snap.media : snap.media ? [snap.media] : []);
                const procs = (Array.isArray(snap.procs) ? snap.procs : snap.procs ? [snap.procs] : []);
                onSnapshot({ media, procs, steam: snap.steam || {} });
            } catch { /* a partial or odd line; the next one comes in seconds */ }
        }
        if (buffer.length > 8 << 20) buffer = ''; // never let a broken stream grow without end
    });
    child.on('error', () => { /* no PowerShell: no detection */ });
    return () => child.kill();
}

module.exports = { startWindowsWatch, playerName, BROWSERS };
