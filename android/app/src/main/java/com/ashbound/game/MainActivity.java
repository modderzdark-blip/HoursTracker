package com.ashbound.game;

import android.os.Bundle;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestHighestRefreshRate();
    }

    /**
     * Many phones keep apps at 60 Hz unless they ask for more: pick the display mode with the
     * highest refresh rate at the current resolution so the WebView's frames (and the game's
     * 120 / Max frame cap) can run at 90-144 Hz.
     */
    private void requestHighestRefreshRate() {
        Window window = getWindow();
        Display display = window.getWindowManager().getDefaultDisplay();
        if (display == null) return;
        Display.Mode current = display.getMode();
        Display.Mode best = current;
        for (Display.Mode m : display.getSupportedModes()) {
            boolean sameSize =
                m.getPhysicalWidth() == current.getPhysicalWidth() &&
                m.getPhysicalHeight() == current.getPhysicalHeight();
            if (sameSize && m.getRefreshRate() > best.getRefreshRate()) best = m;
        }
        WindowManager.LayoutParams params = window.getAttributes();
        params.preferredDisplayModeId = best.getModeId();
        params.preferredRefreshRate = best.getRefreshRate();
        window.setAttributes(params);
    }
}
