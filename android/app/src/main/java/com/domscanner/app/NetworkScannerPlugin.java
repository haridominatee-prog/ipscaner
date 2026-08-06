package com.domscanner.app;

import android.Manifest;
import android.content.Context;
import android.net.DhcpInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.text.format.Formatter;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

@CapacitorPlugin(
    name = "NetworkScanner",
    permissions = {
        @Permission(
            alias = "network",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_WIFI_STATE
            }
        )
    }
)
public class NetworkScannerPlugin extends Plugin {

    @PluginMethod
    public void getNetworkInfo(PluginCall call) {
        try {
            Context context = getContext();
            WifiManager wifiManager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);

            WifiInfo wifiInfo = wifiManager != null ? wifiManager.getConnectionInfo() : null;
            DhcpInfo dhcpInfo = wifiManager != null ? wifiManager.getDhcpInfo() : null;

            String ipStr = getLocalIpStr(wifiInfo);
            String gatewayStr = getGatewayIpStr(dhcpInfo);
            String ssid = getSsidStr(wifiInfo);
            int rssi = wifiInfo != null ? wifiInfo.getRssi() : -50;
            int signalLevel = WifiManager.calculateSignalLevel(rssi, 100);

            JSObject ret = new JSObject();
            ret.put("localIp", ipStr);
            ret.put("gateway", gatewayStr);
            ret.put("ssid", ssid);
            ret.put("signal", signalLevel + "%");
            ret.put("subnet", getSubnetPrefix(gatewayStr) + ".0/24");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Error fetching network info: " + e.getMessage());
        }
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        if (getPermissionState("network") != PermissionState.GRANTED) {
            requestPermissionForAlias("network", call, "networkPermissionsCallback");
            return;
        }
        executeScan(call);
    }

    @PermissionCallback
    private void networkPermissionsCallback(PluginCall call) {
        executeScan(call);
    }

    private void executeScan(PluginCall call) {
        ExecutorService executor = Executors.newFixedThreadPool(60);
        try {
            Context context = getContext();
            WifiManager wifiManager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            DhcpInfo dhcpInfo = wifiManager != null ? wifiManager.getDhcpInfo() : null;
            WifiInfo wifiInfo = wifiManager != null ? wifiManager.getConnectionInfo() : null;

            String gatewayStr = getGatewayIpStr(dhcpInfo);
            String myIp = getLocalIpStr(wifiInfo);
            String prefix = getSubnetPrefix(gatewayStr);

            Map<String, String> arpMap = readARPTable();
            JSArray devices = new JSArray();
            AtomicInteger scannedCount = new AtomicInteger(0);
            AtomicInteger foundCount = new AtomicInteger(0);

            // Build list of target IP prefixes to check (primary Wi-Fi + common fallback subnets if disconnected)
            List<String> prefixes = new ArrayList<>();
            prefixes.add(prefix);
            if (!prefix.equals("192.168.0") && !prefix.equals("192.168.1")) {
                prefixes.add("192.168.0");
                prefixes.add("192.168.1");
            }

            int totalTargetIps = prefixes.size() * 254;

            for (String subPrefix : prefixes) {
                for (int i = 1; i <= 254; i++) {
                    final String targetIp = subPrefix + "." + i;
                    executor.execute(() -> {
                        boolean reachable = false;
                        try {
                            // 1. Standard InetAddress reachability
                            InetAddress addr = InetAddress.getByName(targetIp);
                            reachable = addr.isReachable(300);

                            // 2. Comprehensive multi-port socket probing for non-root Android
                            if (!reachable) {
                                int[] probePorts = {80, 443, 8080, 22, 139, 445, 53, 3389, 8000, 5000, 8888, 1900};
                                for (int port : probePorts) {
                                    try (Socket socket = new Socket()) {
                                        socket.connect(new InetSocketAddress(targetIp, port), 200);
                                        reachable = true;
                                        break;
                                    } catch (IOException ignored) {}
                                }
                            }

                            if (reachable) {
                                foundCount.incrementAndGet();
                                boolean isGw = targetIp.equals(gatewayStr);
                                boolean isMe = targetIp.equals(myIp);
                                String mac = arpMap.getOrDefault(targetIp, "—");

                                JSObject dev = new JSObject();
                                dev.put("ip", targetIp);
                                dev.put("mac", mac);
                                dev.put("isGateway", isGw);
                                dev.put("isMe", isMe);
                                dev.put("vendor", isGw ? "Router / Access Point" : (isMe ? "This Mobile Phone" : getVendorFromMac(mac)));
                                dev.put("deviceType", getDeviceTypeObj(isGw, isMe));

                                synchronized (devices) {
                                    devices.put(dev);
                                }

                                notifyListeners("deviceDiscovered", dev);
                            }
                        } catch (Exception ignored) {
                        } finally {
                            int currentScanned = scannedCount.incrementAndGet();
                            JSObject progress = new JSObject();
                            progress.put("scanned", currentScanned);
                            progress.put("total", totalTargetIps);
                            progress.put("found", foundCount.get());
                            notifyListeners("scanProgress", progress);
                        }
                    });
                }
            }

            executor.shutdown();
            executor.awaitTermination(15, TimeUnit.SECONDS);

            JSObject ret = new JSObject();
            ret.put("devices", devices);
            ret.put("totalFound", foundCount.get());
            call.resolve(ret);

        } catch (Exception e) {
            call.reject("Scan error: " + e.getMessage());
        }
    }

    @PluginMethod
    public void scanPorts(PluginCall call) {
        String targetIp = call.getString("ip");
        if (targetIp == null || targetIp.isEmpty()) {
            call.reject("Target IP required");
            return;
        }

        ExecutorService executor = Executors.newFixedThreadPool(25);
        int[] commonPorts = {21, 22, 23, 25, 53, 80, 110, 139, 443, 445, 1433, 1521, 3306, 3389, 5432, 5900, 8080, 8443, 9000};
        JSArray openPorts = new JSArray();

        for (int port : commonPorts) {
            executor.execute(() -> {
                try (Socket socket = new Socket()) {
                    socket.connect(new InetSocketAddress(targetIp, port), 400);
                    synchronized (openPorts) {
                        openPorts.put(port);
                    }
                } catch (IOException ignored) {}
            });
        }

        executor.shutdown();
        try {
            executor.awaitTermination(6, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {}

        JSObject ret = new JSObject();
        ret.put("ip", targetIp);
        ret.put("openPorts", openPorts);
        call.resolve(ret);
    }

    private String getLocalIpStr(WifiInfo wifiInfo) {
        if (wifiInfo != null) {
            int ip = wifiInfo.getIpAddress();
            if (ip != 0) {
                return Formatter.formatIpAddress(ip);
            }
        }
        return "192.168.1.100";
    }

    private String getGatewayIpStr(DhcpInfo dhcpInfo) {
        if (dhcpInfo != null && dhcpInfo.gateway != 0) {
            String gw = Formatter.formatIpAddress(dhcpInfo.gateway);
            if (gw != null && !gw.equals("0.0.0.0")) {
                return gw;
            }
        }
        return "192.168.1.1";
    }

    private String getSsidStr(WifiInfo wifiInfo) {
        if (wifiInfo != null && wifiInfo.getSSID() != null) {
            String ssid = wifiInfo.getSSID().replace("\"", "");
            if (!ssid.isEmpty() && !ssid.equals("<unknown ssid>")) {
                return ssid;
            }
        }
        return "Mobile Wi-Fi";
    }

    private String getSubnetPrefix(String ip) {
        if (ip == null || !ip.contains(".")) return "192.168.1";
        String[] parts = ip.split("\\.");
        return parts[0] + "." + parts[1] + "." + parts[2];
    }

    private String getVendorFromMac(String mac) {
        if (mac == null || mac.equals("—") || mac.length() < 8) return "Network Device";
        String prefix = mac.toUpperCase().substring(0, 8);
        if (prefix.startsWith("00:50:56") || prefix.startsWith("00:0C:29")) return "VMware";
        if (prefix.startsWith("08:00:27")) return "VirtualBox";
        if (prefix.startsWith("B8:27:EB") || prefix.startsWith("DC:A6:32") || prefix.startsWith("E4:5F:01")) return "Raspberry Pi";
        if (prefix.startsWith("00:1A:11") || prefix.startsWith("AC:12:03")) return "Google";
        if (prefix.startsWith("3C:22:FB") || prefix.startsWith("F4:0F:24")) return "Apple";
        if (prefix.startsWith("70:48:0F") || prefix.startsWith("EC:F0:0E")) return "TP-Link";
        return "Network Device";
    }

    private JSObject getDeviceTypeObj(boolean isGw, boolean isMe) {
        JSObject obj = new JSObject();
        if (isGw) {
            obj.put("type", "router");
            obj.put("label", "Gateway / Router");
            obj.put("icon", "router");
        } else if (isMe) {
            obj.put("type", "phone");
            obj.put("label", "This Mobile Device");
            obj.put("icon", "phone");
        } else {
            obj.put("type", "unknown");
            obj.put("label", "Network Device");
            obj.put("icon", "unknown");
        }
        return obj;
    }

    private Map<String, String> readARPTable() {
        Map<String, String> map = new HashMap<>();
        try (BufferedReader br = new BufferedReader(new FileReader("/proc/net/arp"))) {
            String line;
            while ((line = br.readLine()) != null) {
                String[] tokens = line.split("\\s+");
                if (tokens.length >= 4 && !tokens[0].equals("IP")) {
                    String ip = tokens[0];
                    String mac = tokens[3];
                    if (!mac.equals("00:00:00:00:00:00")) {
                        map.put(ip, mac);
                    }
                }
            }
        } catch (Exception ignored) {}
        return map;
    }
}
