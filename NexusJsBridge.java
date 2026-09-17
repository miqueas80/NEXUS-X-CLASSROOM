package com.nexus.classroom;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import android.util.Base64;

public final class NexusJsBridge {
  private final WebView web; private final NearbyEngine engine;
  public NexusJsBridge(WebView w){web=w;engine=new NearbyEngine(w.getContext(),this::emit);}
  private void emit(String name,String json){web.post(()->web.evaluateJavascript("window.dispatchEvent(new CustomEvent('nexus:native:"+name+',{detail:"+json+"}));",null));}
  @JavascriptInterface public String getStatus(){return "{\"nearbyReady\":"+(engine.radiosReady()?"true":"false")+",\"service\":\"com.nexus.classroom\",\"strategy\":\"P2P_CLUSTER\"}";}
  @JavascriptInterface public void startAdvertising(String name){if(!engine.radiosReady()){emit("radio_required","{\"message\":\"Activa Bluetooth o Wi-Fi para usar Red Nexus cercana.\"}");return;}engine.advertise(name==null?"NEXUS":name);}
  @JavascriptInterface public void startDiscovery(){if(!engine.radiosReady()){emit("radio_required","{\"message\":\"Activa Bluetooth o Wi-Fi para descubrir dispositivos.\"}");return;}engine.discover();}
  @JavascriptInterface public void request(String endpointId,String name){engine.request(endpointId,name==null?"NEXUS":name);}
  @JavascriptInterface public void accept(String endpointId){engine.accept(endpointId);}
  @JavascriptInterface public void reject(String endpointId){engine.reject(endpointId);}
  @JavascriptInterface public void sendBase64(String endpointId,String base64){byte[] b=Base64.decode(base64,Base64.DEFAULT);engine.send(endpointId,b);}
  @JavascriptInterface public void stop(){engine.stop();}
}
