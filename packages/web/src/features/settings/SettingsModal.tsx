import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings } from './types';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { IS_ELECTRON as isElectron, IS_TOUCH as isTouchDevice } from '../../lib/env';
import './settings.css';
import '../room/ScreenShareModal/screen-share-modal.css';
import { ProfileSection } from './sections/ProfileSection';
import { SecuritySection } from './sections/SecuritySection';
import { DevicesSection } from './sections/DevicesSection';
import { AudioSection } from './sections/AudioSection';
import { VideoSection } from './sections/VideoSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { ScreenShareSection } from './sections/ScreenShareSection';
import { ChatSection } from './sections/ChatSection';
import { SoundsSection } from './sections/SoundsSection';
import { KeybindsSection } from './sections/KeybindsSection';
import { DesktopSection } from './sections/DesktopSection';

type Section = 'profile' | 'security' | 'devices' | 'audio' | 'video' | 'appearance' | 'screenshare' | 'chat' | 'sounds' | 'keybinds' | 'desktop';

interface SettingsModalProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
  displayName?: string;
  onRename?: (name: string) => void;
  myAvatar?: string | null;
  onAvatarChange?: (dataUrl: string | null) => void;
}


export function SettingsModal({ settings, onUpdate, onClose, displayName, onRename, myAvatar, onAvatarChange }: SettingsModalProps) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<Section>('profile');
  const [micMonitor, setMicMonitor] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<Section, HTMLElement>>(new Map());
  const keybindCleanupRef = useRef<(() => void) | null>(null);

  // Clean up any dangling keybind listener on unmount
  useEffect(() => {
    return () => { keybindCleanupRef.current?.(); };
  }, []);

  const NAV: { group: string; items: { id: Section; label: string }[] }[] = useMemo(() => [
    {
      group: t('settings.account'),
      items: [
        { id: 'profile', label: t('settings.profile') },
        { id: 'security', label: t('settings.security') },
      ],
    },
    {
      group: t('settings.voiceVideo'),
      items: [
        { id: 'devices', label: t('settings.devices') },
        { id: 'audio', label: t('settings.audio') },
        { id: 'video', label: t('settings.video') },
      ],
    },
    {
      group: t('settings.app'),
      items: [
        { id: 'appearance', label: t('settings.appearance') },
        { id: 'screenshare', label: t('settings.screenShare') },
        { id: 'chat', label: t('settings.chat') },
        { id: 'sounds', label: t('settings.sounds') },
        ...(!isTouchDevice ? [{ id: 'keybinds' as Section, label: t('settings.keybinds') }] : []),
        ...(isElectron ? [{ id: 'desktop' as Section, label: t('settings.desktop') }] : []),
      ],
    },
  ], [t]);

  const handleClose = useCallback(() => {
    setMicMonitor(false);
    keybindCleanupRef.current?.();
    onClose();
  }, [onClose]);

  useEscapeKey(handleClose);

  // Update active nav item based on scroll position
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onScroll = () => {
      const scrollTop = el.scrollTop;
      let current: Section = 'devices';
      sectionRefs.current.forEach((ref, id) => {
        if (ref.offsetTop - 60 <= scrollTop) current = id;
      });
      setActiveSection(current);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = useCallback((id: Section) => {
    const ref = sectionRefs.current.get(id);
    if (ref && contentRef.current) {
      contentRef.current.scrollTo({ top: ref.offsetTop - 16, behavior: 'smooth' });
    }
  }, []);

  const setSectionRef = (id: Section) => (el: HTMLElement | null) => {
    if (el) sectionRefs.current.set(id, el);
  };

  return (
    <div className="settings-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) handleClose();
    }}>
      <div className="settings-modal-box">

        {/* -- Sidebar -- */}
        <div className="settings-sidebar">
          <div className="settings-sidebar-nav">
            <div className="settings-sidebar-title">{t('settings.title')}</div>
            {NAV.map(group => (
              <div key={group.group} className="settings-nav-group">
                <div className="settings-nav-group-label">{group.group}</div>
                {group.items.map(item => (
                  <button
                    key={item.id}
                    className={`settings-nav-item${activeSection === item.id ? ' active' : ''}`}
                    onClick={() => scrollTo(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* -- Content -- */}
        <div className="settings-content-area" ref={contentRef}>
          <button className="settings-close-circle" onClick={handleClose} title="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <div className="settings-content-container">

            <ProfileSection
              headerRef={setSectionRef('profile')}
              displayName={displayName}
              onRename={onRename}
              myAvatar={myAvatar}
              onAvatarChange={onAvatarChange}
            />

            <SecuritySection headerRef={setSectionRef('security')} />

            <DevicesSection
              headerRef={setSectionRef('devices')}
              settings={settings}
              onUpdate={onUpdate}
              micMonitor={micMonitor}
              setMicMonitor={setMicMonitor}
            />

            <AudioSection
              headerRef={setSectionRef('audio')}
              settings={settings}
              onUpdate={onUpdate}
              keybindCleanupRef={keybindCleanupRef}
            />

            <VideoSection headerRef={setSectionRef('video')} settings={settings} onUpdate={onUpdate} />

            <AppearanceSection headerRef={setSectionRef('appearance')} settings={settings} onUpdate={onUpdate} />

            <ScreenShareSection headerRef={setSectionRef('screenshare')} settings={settings} onUpdate={onUpdate} />

            <ChatSection headerRef={setSectionRef('chat')} settings={settings} onUpdate={onUpdate} />

            <SoundsSection headerRef={setSectionRef('sounds')} settings={settings} onUpdate={onUpdate} />

            {!isTouchDevice && (
              <KeybindsSection
                headerRef={setSectionRef('keybinds')}
                settings={settings}
                onUpdate={onUpdate}
                keybindCleanupRef={keybindCleanupRef}
              />
            )}

            {isElectron && <DesktopSection headerRef={setSectionRef('desktop')} />}

          {/* -- About -- */}
          <div className="settings-about">
            <span className="settings-about-name">Lala</span>
            <span className="settings-about-sep">&middot;</span>
            <a href="https://github.com/eeegoloauq/lala" target="_blank" rel="noopener noreferrer" className="settings-about-link">
              {t('settings.sourceCode')}
            </a>
          </div>

          </div>
        </div>
      </div>
    </div>
  );
}
