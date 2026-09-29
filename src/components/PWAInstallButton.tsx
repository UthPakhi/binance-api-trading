import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePWAInstall } from '../lib/usePWAInstall';
import { Button } from './Button';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <Button
        onClick={install}
        size="sm"
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white"
      >
        <Download className="w-4 h-4" />
        Install App
      </Button>
    );
  }

  // iOS Safari flow (beforeinstallprompt is not supported by WebKit)
  if (isIOS) {
    return (
      <>
        <Button
          onClick={() => setShowIOSGuide(true)}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 text-xs font-medium border-neutral-700 text-neutral-300 hover:bg-neutral-800"
        >
          <Download className="w-4 h-4" />
          Install on iOS
        </Button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-xl bg-neutral-900 border border-neutral-800 p-6 shadow-xl">
              <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <Download className="w-5 h-5 text-sky-400" />
                Install Trade Sizer
              </h3>
              <p className="mt-2 text-sm text-neutral-400 leading-relaxed">
                1. Tap the <strong>Share</strong> button in your Safari toolbar.<br />
                2. Scroll down and tap <strong>Add to Home Screen</strong>.
              </p>
              <Button
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full"
                variant="outline"
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
