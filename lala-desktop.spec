# Built in Copr (eeegoloauq/lala) via the rpkg method; custom macros live in
# rpkg.macros. Needs network during build (npm ci + Electron download).

# Electron ships prebuilt, stripped binaries — no debuginfo to extract,
# and its bundled .so files must not leak into RPM provides/requires.
%global debug_package %{nil}
%global _build_id_links none
%global __provides_exclude_from ^%{_prefix}/lib/lala/.*$
%global __requires_exclude ^(libffmpeg\\.so.*|libEGL\\.so.*|libGLESv2\\.so.*|libvk_swiftshader\\.so.*|libvulkan\\.so.*)$

Name:           lala-desktop
Version:        {{{ lala_version }}}
Release:        {{{ lala_release }}}%{?dist}
Summary:        Self-hosted voice and video chat (Lala desktop client)
License:        MIT
URL:            https://github.com/eeegoloauq/lala
Source0:        {{{ git_dir_pack }}}

# Electron only ships x64/arm64 Linux builds
ExclusiveArch:  x86_64 aarch64

BuildRequires:  nodejs >= 20
BuildRequires:  nodejs-npm
BuildRequires:  desktop-file-utils
BuildRequires:  libappstream-glib

%description
Lala is self-hosted voice and video chat built on LiveKit (WebRTC SFU) —
like Mumble or Discord, but yours. This package contains the Electron
desktop client.

%prep
{{{ git_dir_setup_macro }}}

%build
cd packages/desktop
npm ci --no-audit --no-fund
npx electron-builder --linux dir

%install
# Unpacked dir is linux-unpacked on x86_64, linux-arm64-unpacked on aarch64
install -dm755 %{buildroot}%{_prefix}/lib/lala
cp -a packages/desktop/dist/linux*unpacked/. %{buildroot}%{_prefix}/lib/lala/
# afterPack hook nests metainfo under usr/ for AppImage; we install it properly below
rm -rf %{buildroot}%{_prefix}/lib/lala/usr

install -dm755 %{buildroot}%{_bindir}
ln -s ../lib/lala/lala-desktop %{buildroot}%{_bindir}/lala-desktop

install -Dm644 packages/desktop/build/lala-desktop.desktop \
    %{buildroot}%{_datadir}/applications/lala-desktop.desktop
install -Dm644 packages/desktop/build/app.lala.desktop.metainfo.xml \
    %{buildroot}%{_metainfodir}/app.lala.desktop.metainfo.xml

for size in 16 24 32 48 64 128 256 512; do
    install -Dm644 packages/desktop/build/icons/${size}x${size}.png \
        %{buildroot}%{_datadir}/icons/hicolor/${size}x${size}/apps/lala-desktop.png
done

%check
desktop-file-validate %{buildroot}%{_datadir}/applications/lala-desktop.desktop
appstream-util validate-relax --nonet %{buildroot}%{_metainfodir}/app.lala.desktop.metainfo.xml

%files
%license LICENSE
%doc README.md
%{_prefix}/lib/lala/
# Chromium's SUID sandbox helper; on kernels with unprivileged userns it is
# unused, but Electron aborts at startup if the file mode is wrong.
%attr(4755,root,root) %{_prefix}/lib/lala/chrome-sandbox
%{_bindir}/lala-desktop
%{_datadir}/applications/lala-desktop.desktop
%{_metainfodir}/app.lala.desktop.metainfo.xml
%{_datadir}/icons/hicolor/*/apps/lala-desktop.png

%changelog
* Sun Jul 05 2026 Egor Solovyov <eeegoloauq@users.noreply.github.com> - 0.0.23-1
- Initial Copr packaging: Electron desktop client built from git via rpkg
