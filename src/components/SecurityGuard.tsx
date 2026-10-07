import React, { useEffect, useState, useRef } from 'react';
import { ShieldAlert, AlertTriangle, Lock, Camera, ShieldCheck, EyeOff, Maximize2 } from 'lucide-react';
import { saveSecurityLogToFirestore } from '../lib/firebase';
import { StudentInfo } from '../types';

interface SecurityGuardProps {
  isActive: boolean; // True when assessment is ongoing
  children: React.ReactNode;
  studentInfo?: StudentInfo | null;
  userRole?: string;
  attemptCount?: number;
  maxAttempts?: number;
  savepointSummary?: {
    answeredCount: number;
    totalQuestions: number;
    timeRemainingText: string;
  };
  onViolationCountChange?: (count: number) => void;
  onTabSwitchInterrupted?: (attemptUsed: number, nextAttempt: number) => void;
  onResumeAssessment?: () => void;
  onSecurityLockout?: (reason: string) => void;
}

export const SecurityGuard: React.FC<SecurityGuardProps> = ({
  isActive,
  children,
  studentInfo,
  userRole = 'guest',
  attemptCount = 1,
  maxAttempts = 3,
  savepointSummary,
  onViolationCountChange,
  onTabSwitchInterrupted,
  onResumeAssessment,
  onSecurityLockout,
}) => {
  const [violationCount, setViolationCount] = useState(0);
  const [isWindowFocused, setIsWindowFocused] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [isScreenMasked, setIsScreenMasked] = useState(false);
  const lastLoggedRef = useRef<Record<string, number>>({});

  const requestFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      setIsFullscreen(true);
    } catch (e) {
      console.warn('Fullscreen request failed or blocked by browser policy:', e);
      setIsFullscreen(!!document.fullscreenElement);
    }
  };

  const logIncident = (
    eventType: 
      | 'CONTEXT_MENU_BLOCKED'
      | 'COPY_CUT_BLOCKED'
      | 'SCREENSHOT_SHORTCUT_BLOCKED'
      | 'PRINT_ATTEMPT_BLOCKED'
      | 'DEVTOOLS_SHORTCUT_BLOCKED'
      | 'UNAUTHORIZED_WINDOW_SWITCH'
      | 'DEVTOOLS_OPENED_DETECTION',
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    details: string
  ) => {
    // Throttle duplicate logs within 2 seconds to avoid spamming
    const now = Date.now();
    if (lastLoggedRef.current[eventType] && now - lastLoggedRef.current[eventType] < 2000) {
      return;
    }
    lastLoggedRef.current[eventType] = now;

    saveSecurityLogToFirestore({
      id: `sec_${now}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'medium'
      }),
      eventType,
      severity,
      details,
      userRegNo: studentInfo?.registerNo || 'N/A',
      userName: studentInfo?.name || (userRole === 'admin' ? 'System Administrator' : userRole === 'faculty' ? 'Faculty Member' : 'Anonymous Guest'),
      userRole: (userRole as any) || (studentInfo ? 'student' : 'guest'),
      ipOrDevice: navigator.userAgent.substring(0, 80),
      resolved: false
    });
  };

  const triggerSecurityToast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    setIsScreenMasked(true);
    
    // Briefly mask screen to spoil print-screen / screenshot buffers
    setTimeout(() => {
      setIsScreenMasked(false);
    }, 800);

    setTimeout(() => {
      setShowToast(false);
    }, 4000);
  };

  // Global anti-copy & shortcut interceptor
  const isActiveRef = useRef(isActive);
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    const handleCopyCut = (e: ClipboardEvent) => {
      // Allow if typing inside editable input/textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      e.preventDefault();
      triggerSecurityToast('Copying and cutting content is strictly prohibited.');
      logIncident('COPY_CUT_BLOCKED', 'MEDIUM', 'User attempted to copy or cut application content.');
    };

    const handleSelectStart = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      e.preventDefault();
    };

    // Right-click contextmenu & mouse button interceptor - strictly prevents context menu and right click actions
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Button 2 is right-click
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    const handleAuxClick = (e: MouseEvent) => {
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const code = e.code;

      // PrintScreen / PrtScn key - ZERO TOLERANCE DURING ASSESSMENT
      if (code === 'PrintScreen' || key === 'printscreen' || key === 'snapshot') {
        e.preventDefault();
        e.stopPropagation();
        if (isActiveRef.current) {
          setIsScreenMasked(true);
          triggerSecurityToast('🚫 Screenshot capture attempt blocked! Assessment window is exiting.');
          logIncident('SCREENSHOT_SHORTCUT_BLOCKED', 'CRITICAL', 'PrintScreen key pressed during live assessment.');
          onSecurityLockout?.('SCREENSHOT_DETECTED');
          return false;
        } else {
          triggerSecurityToast('🚫 Screenshot capture attempt blocked! Screenshots are prohibited.');
          logIncident('SCREENSHOT_SHORTCUT_BLOCKED', 'HIGH', 'PrintScreen key pressed.');
          return false;
        }
      }

      // Windows Snipping Tool (Win+Shift+S), Mac Screenshots (Cmd+Shift+3/4/5), Ctrl+Shift+S
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (key === 's' || key === '3' || key === '4' || key === '5' || code === 'KeyS')
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (isActiveRef.current) {
          setIsScreenMasked(true);
          triggerSecurityToast('🚫 Screen snipping / screenshot attempt blocked! Assessment window is exiting.');
          logIncident('SCREENSHOT_SHORTCUT_BLOCKED', 'CRITICAL', 'OS screenshot shortcut combination triggered during live assessment.');
          onSecurityLockout?.('SCREENSHOT_DETECTED');
          return false;
        } else {
          triggerSecurityToast('🚫 Screenshot shortcut blocked!');
          logIncident('SCREENSHOT_SHORTCUT_BLOCKED', 'HIGH', 'Screenshot shortcut combination triggered.');
          return false;
        }
      }

      // Ctrl+P / Cmd+P (Print)
      if ((e.ctrlKey || e.metaKey) && key === 'p') {
        if (isActiveRef.current) {
          e.preventDefault();
          e.stopPropagation();
          setIsScreenMasked(true);
          triggerSecurityToast('🚫 Printing or print-to-PDF is disabled during assessment. Exiting window.');
          logIncident('PRINT_ATTEMPT_BLOCKED', 'CRITICAL', 'Print shortcut (Ctrl+P / Cmd+P) triggered during live test.');
          onSecurityLockout?.('SCREENSHOT_DETECTED');
          return false;
        }
      }

      // Ctrl+S / Cmd+S (Save page)
      if ((e.ctrlKey || e.metaKey) && key === 's') {
        e.preventDefault();
        e.stopPropagation();
        triggerSecurityToast('🚫 Saving page source or assets is disabled.');
        return false;
      }

      // DevTools: F12, Ctrl+Shift+I, Ctrl+Shift+C, Cmd+Option+I, Ctrl+U (View Source)
      if (
        e.key === 'F12' ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'i' || key === 'c' || key === 'j')) ||
        ((e.ctrlKey || e.metaKey) && key === 'u')
      ) {
        e.preventDefault();
        e.stopPropagation();
        triggerSecurityToast('🚫 Developer Tools & View Source are disabled.');
        logIncident('DEVTOOLS_SHORTCUT_BLOCKED', 'HIGH', 'DevTools / View Source shortcut triggered.');
        return false;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const code = e.code;
      // Some browsers / OS only dispatch PrintScreen on keyup
      if (code === 'PrintScreen' || key === 'printscreen' || key === 'snapshot') {
        e.preventDefault();
        e.stopPropagation();
        if (isActiveRef.current) {
          setIsScreenMasked(true);
          triggerSecurityToast('🚫 Screenshot capture attempt blocked! Assessment window is exiting.');
          logIncident('SCREENSHOT_SHORTCUT_BLOCKED', 'CRITICAL', 'PrintScreen keyup event detected during live assessment.');
          onSecurityLockout?.('SCREENSHOT_DETECTED');
          return false;
        }
      }
    };

    const handleBeforePrint = (e: Event) => {
      if (isActiveRef.current) {
        e.preventDefault();
        setIsScreenMasked(true);
        logIncident('PRINT_ATTEMPT_BLOCKED', 'CRITICAL', 'Browser print dialog attempted during live assessment.');
        onSecurityLockout?.('SCREENSHOT_DETECTED');
      }
    };

    // DevTools open size threshold detector (Only in standalone windows, ignored inside iframes)
    const isInsideIframe = typeof window !== 'undefined' && window.self !== window.top;
    const devToolsCheckInterval = !isInsideIframe && isActive ? setInterval(() => {
      const threshold = 170;
      const widthDiff = window.outerWidth - window.innerWidth > threshold;
      const heightDiff = window.outerHeight - window.innerHeight > threshold;
      if (widthDiff || heightDiff) {
        logIncident('DEVTOOLS_OPENED_DETECTION', 'CRITICAL', `Browser Developer Console opened (Viewport diff: ${window.outerWidth - window.innerWidth}x${window.outerHeight - window.innerHeight}).`);
      }
    }, 15000) : null;

    window.addEventListener('copy', handleCopyCut);
    window.addEventListener('cut', handleCopyCut);
    window.addEventListener('selectstart', handleSelectStart);
    window.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
    window.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('auxclick', handleAuxClick, true);
    document.addEventListener('auxclick', handleAuxClick, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('beforeprint', handleBeforePrint);

    return () => {
      if (devToolsCheckInterval) clearInterval(devToolsCheckInterval);
      window.removeEventListener('copy', handleCopyCut);
      window.removeEventListener('cut', handleCopyCut);
      window.removeEventListener('selectstart', handleSelectStart);
      window.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('contextmenu', handleContextMenu, true);
      window.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('auxclick', handleAuxClick, true);
      document.removeEventListener('auxclick', handleAuxClick, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('beforeprint', handleBeforePrint);
    };
  }, [studentInfo, userRole, onSecurityLockout]);

  // Assessment Window Switching & Focus Loss Handling (Active when assessment is running)
  // ZERO TOLERANCE: Do not allow tab switches or screenshots. Exit the window immediately with a warning.
  const switchCountRef = useRef(0);
  const isSwitchedOutRef = useRef(false);

  useEffect(() => {
    if (!isActive) {
      switchCountRef.current = 0;
      isSwitchedOutRef.current = false;
      setViolationCount(0);
      setIsWindowFocused(true);
      return;
    }

    // Prohibit and intercept all pop-up windows during assessment
    const originalOpen = window.open;
    const originalAlert = window.alert;
    const originalConfirm = window.confirm;
    const originalPrompt = window.prompt;

    // Override window.open to suppress pop-up windows
    window.open = function (...args: any[]) {
      console.warn('Pop-up window blocked during assessment:', args);
      logIncident(
        'UNAUTHORIZED_WINDOW_SWITCH',
        'HIGH',
        'Attempted to launch pop-up window during assessment.'
      );
      triggerSecurityToast('🚫 Pop-up windows are strictly prohibited during assessment.');
      return null;
    };

    // Override browser native pop-up dialogs
    window.alert = function (msg?: any) {
      console.warn('Browser alert pop-up blocked during assessment:', msg);
    };

    window.confirm = function (msg?: string) {
      console.warn('Browser confirm pop-up blocked during assessment:', msg);
      return false;
    };

    window.prompt = function (msg?: string) {
      console.warn('Browser prompt pop-up blocked during assessment:', msg);
      return null;
    };

    // Intercept clicks on links or elements attempting to open new pop-up windows
    const handlePopUpClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest('a');
      if (
        target &&
        (target.target === '_blank' ||
          target.target === '_popup' ||
          target.getAttribute('rel')?.includes('external') ||
          target.hasAttribute('onclick'))
      ) {
        e.preventDefault();
        e.stopPropagation();
        triggerSecurityToast('🚫 External pop-up links are disabled during assessment.');
        logIncident(
          'UNAUTHORIZED_WINDOW_SWITCH',
          'MEDIUM',
          `Attempted to open external pop-up link: ${target.href || 'N/A'}`
        );
      }
    };

    window.addEventListener('click', handlePopUpClick, true);

    // Fullscreen enforcement during assessment
    const handleFullscreenChange = () => {
      const isFS = !!document.fullscreenElement;
      setIsFullscreen(isFS);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // Initial fullscreen request when assessment becomes active
    if (isActive) {
      requestFullscreen();
    }

    return () => {
      window.open = originalOpen;
      window.alert = originalAlert;
      window.confirm = originalConfirm;
      window.prompt = originalPrompt;
      window.removeEventListener('click', handlePopUpClick, true);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, [isActive, studentInfo, userRole, onViolationCountChange, onSecurityLockout]);

  const handleDismissMask = () => {
    setIsScreenMasked(false);
  };

  return (
    <div className="relative min-h-screen select-none">
      {/* Fallback Visual Masking Screen for unauthorized screenshot capture */}
      {isScreenMasked && (
        <div className="fixed inset-0 z-[99999] bg-slate-950 flex flex-col items-center justify-center p-6 text-center text-white select-none animate-in fade-in duration-100">
          <div className="w-16 h-16 rounded-2xl bg-rose-600/20 border border-rose-500/40 flex items-center justify-center mb-4 animate-pulse">
            <ShieldAlert className="w-10 h-10 text-rose-500" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-rose-400 font-bold mb-1">
            COIMBATORE INSTITUTE OF TECHNOLOGY • PROCTORING SYSTEM
          </span>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white mb-2">
            PROCTORING VIOLATION DETECTED
          </h2>
          <p className="text-xs sm:text-sm text-rose-200 font-medium max-w-md mb-4 leading-relaxed">
            Unauthorized screenshot capture attempt detected. Your responses remain safely saved.
          </p>
          <button
            type="button"
            onClick={handleDismissMask}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow cursor-pointer flex items-center gap-2"
          >
            <Maximize2 className="w-4 h-4" />
            <span>Return to Assessment Window</span>
          </button>
        </div>
      )}

      {/* Floating Toast Message */}
      {showToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[99998] max-w-md w-full px-4 animate-in slide-in-from-top duration-200">
          <div className="bg-rose-600 text-white px-4 py-3 rounded-xl shadow-2xl border border-rose-700 flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-white shrink-0" />
            <p className="text-xs font-bold leading-tight">{toastMessage}</p>
          </div>
        </div>
      )}

      {/* Subtle Security & Anti-Leak Watermark Overlay */}
      <div className="fixed inset-0 pointer-events-none z-[9990] overflow-hidden opacity-[0.035] flex flex-col justify-around rotate-[-15deg] select-none text-slate-900 font-mono font-black text-xs sm:text-sm uppercase tracking-widest whitespace-nowrap">
        <div className="flex justify-between gap-12">
          <span>CIT COGNITIVE ASSESSMENT SYSTEM</span>
          <span>ADMIN PROTECTED • DO NOT COPY</span>
          <span>CONFIDENTIAL SESSION</span>
        </div>
        <div className="flex justify-between gap-12">
          <span>UNAUTHORIZED ACCESS PROHIBITED</span>
          <span>REG: {studentInfo?.registerNo || 'PROTECTED-NODE'}</span>
          <span>STRICT PROCTORING</span>
        </div>
        <div className="flex justify-between gap-12">
          <span>CIT COGNITIVE ASSESSMENT SYSTEM</span>
          <span>ADMIN PROTECTED • DO NOT COPY</span>
          <span>CONFIDENTIAL SESSION</span>
        </div>
      </div>

      {/* Main App Content */}
      <div className="transition-all duration-300">
        {children}
      </div>
    </div>
  );
};

