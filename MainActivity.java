package com.nexus.classroom;

import android.Manifest; import android.app.Activity; import android.os.Bundle; import android.os.Build; import android.webkit.*; import android.view.ViewGroup; import java.util.ArrayList; import java.util.List;

public final class MainActivity extends Activity {
  private WebView web;
  @Override public void onCreate(Bundle b){super.onCreate(b);web=new WebView(this);setContentView(web,new ViewGroup.LayoutParams(-1,-1));
    WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setDatabaseEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);
    web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,String url){return !url.startsWith("file:///android_asset/") && !url.startsWith("https://miqueas80.github.io/") && !url.startsWith("https://red-nexus-classroom.onrender.com/");}});
    web.addJavascriptInterface(new NexusJsBridge(web),"NexusNative");web.loadUrl("file:///android_asset/index.html");
    requestNearbyPermissions();
  }
  private void requestNearbyPermissions(){List<String> p=new ArrayList<>();if(Build.VERSION.SDK_INT>=31){p.add(Manifest.permission.BLUETOOTH_SCAN);p.add(Manifest.permission.BLUETOOTH_CONNECT);p.add(Manifest.permission.BLUETOOTH_ADVERTISE);}if(Build.VERSION.SDK_INT>=33)p.add(Manifest.permission.NEARBY_WIFI_DEVICES);if(Build.VERSION.SDK_INT<=30)p.add(Manifest.permission.ACCESS_FINE_LOCATION);if(!p.isEmpty())requestPermissions(p.toArray(new String[0]),7001);}
}
