package app.sweetcascade.game;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Small app-specific bridge: build info, keep-awake, immersive re-apply and the system photo picker
 * (no storage permission; the picked photo is downscaled on-device and returned as a JPEG data URL).
 */
@CapacitorPlugin(name = "NativeShell")
public class NativeShellPlugin extends Plugin {

    private static final int DEFAULT_MAX_PHOTO_EDGE = 1280;

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject info = new JSObject();
        boolean is_debuggable = (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        info.put("debug", is_debuggable);
        info.put("sdkInt", Build.VERSION.SDK_INT);
        try {
            PackageInfo package_info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            info.put("versionName", package_info.versionName);
            info.put("versionCode", Build.VERSION.SDK_INT >= 28 ? package_info.getLongVersionCode() : package_info.versionCode);
        } catch (Exception package_error) {
            info.put("versionName", "unknown");
            info.put("versionCode", 0);
        }
        call.resolve(info);
    }

    @PluginMethod
    public void getSafeArea(PluginCall call) {
        int[] css_px = MainActivity.getSafeAreaCssPx();
        JSObject safe_area = new JSObject();
        safe_area.put("top", css_px[0]);
        safe_area.put("right", css_px[1]);
        safe_area.put("bottom", css_px[2]);
        safe_area.put("left", css_px[3]);
        call.resolve(safe_area);
    }

    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        boolean keep_awake = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getBridge().executeOnMainThread(() -> {
            Activity activity = getActivity();
            if (activity != null) {
                if (keep_awake) {
                    activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void reapplyImmersive(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            Activity activity = getActivity();
            if (activity instanceof MainActivity) {
                ((MainActivity) activity).applyImmersiveMode();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void pickPhoto(PluginCall call) {
        PickVisualMediaRequest picker_request = new PickVisualMediaRequest.Builder()
            .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE)
            .build();
        Intent picker_intent = new ActivityResultContracts.PickVisualMedia().createIntent(getContext(), picker_request);
        startActivityForResult(call, picker_intent, "onPhotoPicked");
    }

    @ActivityCallback
    private void onPhotoPicked(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }
        Uri photo_uri = result.getData().getData();
        int max_edge = call.getInt("maxEdge", DEFAULT_MAX_PHOTO_EDGE);
        new Thread(() -> {
            try {
                String data_url = decodeDownscaledJpeg(photo_uri, max_edge);
                JSObject picked = new JSObject();
                picked.put("cancelled", false);
                picked.put("dataUrl", data_url);
                call.resolve(picked);
            } catch (Exception decode_error) {
                call.reject("Could not read that photo", decode_error);
            }
        }).start();
    }

    private String decodeDownscaledJpeg(Uri photo_uri, int max_edge) throws Exception {
        BitmapFactory.Options bounds_options = new BitmapFactory.Options();
        bounds_options.inJustDecodeBounds = true;
        try (InputStream bounds_stream = getContext().getContentResolver().openInputStream(photo_uri)) {
            BitmapFactory.decodeStream(bounds_stream, null, bounds_options);
        }
        int longest_edge = Math.max(bounds_options.outWidth, bounds_options.outHeight);
        if (longest_edge <= 0) {
            throw new IllegalStateException("Unreadable image");
        }
        int sample_size = 1;
        while (longest_edge / (sample_size * 2) >= max_edge) {
            sample_size *= 2;
        }
        BitmapFactory.Options decode_options = new BitmapFactory.Options();
        decode_options.inSampleSize = sample_size;
        Bitmap decoded_bitmap;
        try (InputStream decode_stream = getContext().getContentResolver().openInputStream(photo_uri)) {
            decoded_bitmap = BitmapFactory.decodeStream(decode_stream, null, decode_options);
        }
        if (decoded_bitmap == null) {
            throw new IllegalStateException("Unreadable image");
        }
        int rotation_degrees = 0;
        try (InputStream exif_stream = getContext().getContentResolver().openInputStream(photo_uri)) {
            if (exif_stream != null) {
                int orientation = new ExifInterface(exif_stream).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                if (orientation == ExifInterface.ORIENTATION_ROTATE_90) rotation_degrees = 90;
                else if (orientation == ExifInterface.ORIENTATION_ROTATE_180) rotation_degrees = 180;
                else if (orientation == ExifInterface.ORIENTATION_ROTATE_270) rotation_degrees = 270;
            }
        } catch (Exception exif_error) {
            rotation_degrees = 0;
        }
        float scale = Math.min(1f, (float) max_edge / Math.max(decoded_bitmap.getWidth(), decoded_bitmap.getHeight()));
        Matrix transform = new Matrix();
        transform.postScale(scale, scale);
        transform.postRotate(rotation_degrees);
        Bitmap final_bitmap = Bitmap.createBitmap(decoded_bitmap, 0, 0, decoded_bitmap.getWidth(), decoded_bitmap.getHeight(), transform, true);
        ByteArrayOutputStream jpeg_bytes = new ByteArrayOutputStream();
        final_bitmap.compress(Bitmap.CompressFormat.JPEG, 82, jpeg_bytes);
        if (final_bitmap != decoded_bitmap) {
            decoded_bitmap.recycle();
        }
        final_bitmap.recycle();
        return "data:image/jpeg;base64," + Base64.encodeToString(jpeg_bytes.toByteArray(), Base64.NO_WRAP);
    }
}
