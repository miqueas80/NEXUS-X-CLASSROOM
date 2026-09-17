package com.nexus.classroom;

import android.content.Context;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.util.Base64;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.*;
import com.google.android.gms.tasks.OnFailureListener;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public final class NearbyEngine {
  public interface Events { void emit(String name, String json); }
  private static final String SERVICE = "com.nexus.classroom";
  private final Context ctx; private final ConnectionsClient client; private final Events events;
  private final Map<String, Boolean> connected = new ConcurrentHashMap<>();
  private final Strategy strategy = Strategy.P2P_CLUSTER;

  public NearbyEngine(Context c, Events e){ctx=c.getApplicationContext();events=e;client=Nearby.getConnectionsClient(ctx);}
  private String q(String s){return "\""+s.replace("\\","\\\\").replace("\"","\\\"")+"\"";}
  private final PayloadCallback payloads = new PayloadCallback(){
    @Override public void onPayloadReceived(String endpointId, Payload payload){
      if(payload.getType()==Payload.Type.BYTES && payload.asBytes()!=null){
        String b64=Base64.encodeToString(payload.asBytes(),Base64.NO_WRAP);
        events.emit("payload", "{\"endpointId\":"+q(endpointId)+",\"base64\":"+q(b64)+"}");
      } else if(payload.getType()==Payload.Type.FILE){ events.emit("file", "{\"endpointId\":"+q(endpointId)+"}"); }
    }
    @Override public void onPayloadTransferUpdate(String endpointId, PayloadTransferUpdate u){
      events.emit("transfer", "{\"endpointId\":"+q(endpointId)+",\"status\":"+q(u.getStatus().toString())+",\"bytes\":"+u.getBytesTransferred()+",\"total\":"+u.getTotalBytes()+"}");
    }
  };
  private final ConnectionLifecycleCallback lifecycle = new ConnectionLifecycleCallback(){
    @Override public void onConnectionInitiated(String id, ConnectionInfo info){
      // Authentication is surfaced to JS; production UI should require explicit confirmation.
      events.emit("connection_request", "{\"endpointId\":"+q(id)+",\"name\":"+q(info.getEndpointName())+",\"digits\":"+q(info.getAuthenticationDigits())+"}");
    }
    @Override public void onConnectionResult(String id, ConnectionResolution r){
      boolean ok=r.getStatus().isSuccess(); if(ok)connected.put(id,true); else connected.remove(id);
      events.emit("connection_result", "{\"endpointId\":"+q(id)+",\"ok\":"+ok+"}");
    }
    @Override public void onDisconnected(String id){connected.remove(id);events.emit("disconnected", "{\"endpointId\":"+q(id)+"}");}
  };
  private final EndpointDiscoveryCallback discovery = new EndpointDiscoveryCallback(){
    @Override public void onEndpointFound(String id, DiscoveredEndpointInfo info){
      events.emit("found", "{\"endpointId\":"+q(id)+",\"name\":"+q(info.getEndpointName())+"}");
    }
    @Override public void onEndpointLost(String id){events.emit("lost", "{\"endpointId\":"+q(id)+"}");}
  };
  public void advertise(String nodeName){client.startAdvertising(nodeName,SERVICE,lifecycle,new AdvertisingOptions.Builder().setStrategy(strategy).build()).addOnFailureListener(e->events.emit("error","{\"op\":\"advertise\",\"message\":"+q(e.getMessage()==null?"error":e.getMessage())+"}"));}
  public void discover(){client.startDiscovery(SERVICE,discovery,new DiscoveryOptions.Builder().setStrategy(strategy).build()).addOnFailureListener(e->events.emit("error","{\"op\":\"discover\",\"message\":"+q(e.getMessage()==null?"error":e.getMessage())+"}"));}
  public void request(String id,String name){client.requestConnection(name,id,lifecycle).addOnFailureListener(e->events.emit("error","{\"op\":\"request\",\"message\":"+q(e.getMessage()==null?"error":e.getMessage())+"}"));}
  public void accept(String id){client.acceptConnection(id,payloads);}
  public void reject(String id){client.rejectConnection(id);}
  public void send(String id,byte[] data){if(data.length>24576)throw new IllegalArgumentException("payload > 24KB");client.sendPayload(id,Payload.fromBytes(data));}
  public boolean radiosReady(){
    boolean bt=true,wifi=true;
    try{BluetoothManager bm=(BluetoothManager)ctx.getSystemService(Context.BLUETOOTH_SERVICE);BluetoothAdapter a=bm==null?null:bm.getAdapter();bt=a==null||a.isEnabled();}catch(Exception ignored){}
    try{WifiManager w=(WifiManager)ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);wifi=w==null||w.isWifiEnabled();}catch(Exception ignored){}
    return bt||wifi;
  }
  public void stop(){client.stopAdvertising();client.stopDiscovery();client.stopAllEndpoints();connected.clear();}
  public boolean isConnected(String id){return connected.getOrDefault(id,false);}
}
