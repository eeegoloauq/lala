"""A music player on the session bus that speaks just enough MPRIS for the desktop app to see it.

Usage: fake-mpris.py <bus suffix> <identity> <title> <cover file to write>
"""
import struct
import sys
import time
import zlib

import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

suffix, identity, title, cover = sys.argv[1:5]


def write_cover(path, size=200):
    """A gradient PNG, written with the standard library only."""
    rows = b''.join(b'\x00' + b''.join(bytes([x * 255 // size, y * 255 // size, 140]) for x in range(size)) for y in range(size))
    chunk = lambda kind, data: struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


write_cover(cover)
started = time.monotonic()
DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()
name = dbus.service.BusName('org.mpris.MediaPlayer2.' + suffix, bus)


class Player(dbus.service.Object):
    @dbus.service.method('org.freedesktop.DBus.Properties', in_signature='ss', out_signature='v')
    def Get(self, interface, prop):
        return self.GetAll(interface)[prop]

    @dbus.service.method('org.freedesktop.DBus.Properties', in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        if interface == 'org.mpris.MediaPlayer2':
            return {'Identity': identity}
        return {
            'PlaybackStatus': 'Playing',
            'Position': dbus.Int64(int((10 + time.monotonic() - started) * 1_000_000)),
            'Metadata': dbus.Dictionary({
                'xesam:title': title,
                'xesam:artist': dbus.Array(['Coastal Lines'], signature='s'),
                'xesam:album': 'Harbor Lights',
                'mpris:length': dbus.Int64(232_000_000),
                'mpris:artUrl': 'file://' + cover,
            }, signature='sv'),
        }


Player(bus, '/org/mpris/MediaPlayer2')
GLib.MainLoop().run()
