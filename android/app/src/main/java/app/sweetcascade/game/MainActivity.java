package app.sweetcascade.game;

import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeShellPlugin.class);
        super.onCreate(savedInstanceState);
        configureWebView();
        applyImmersiveMode();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyImmersiveMode();
    }

    @Override
    public void onWindowFocusChanged(boolean has_focus) {
        super.onWindowFocusChanged(has_focus);
        if (has_focus) {
            applyImmersiveMode();
        }
    }

    /** Edge-to-edge, both system bars hidden, swipe from an edge to reveal them transiently. */
    void applyImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams layout_params = getWindow().getAttributes();
            layout_params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(layout_params);
        }
        WindowInsetsControllerCompat insets_controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        insets_controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        insets_controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    /** No scrollbars, overscroll glow, zoom, long-press menu or font scaling; DevTools only in debuggable builds. */
    private void configureWebView() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        WebView game_web_view = getBridge().getWebView();
        WebSettings web_settings = game_web_view.getSettings();
        web_settings.setTextZoom(100);
        web_settings.setSupportZoom(false);
        web_settings.setBuiltInZoomControls(false);
        web_settings.setDisplayZoomControls(false);
        web_settings.setMediaPlaybackRequiresUserGesture(false);
        game_web_view.setOverScrollMode(View.OVER_SCROLL_NEVER);
        game_web_view.setVerticalScrollBarEnabled(false);
        game_web_view.setHorizontalScrollBarEnabled(false);
        game_web_view.setLongClickable(false);
        game_web_view.setHapticFeedbackEnabled(false);
        game_web_view.setOnLongClickListener(view -> true);
        boolean is_debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(is_debuggable);
    }
}
