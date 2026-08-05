package com.domscanner.app;

import android.content.Context;
import android.net.DhcpInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.text.format.Formatter;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "NetworkScanner")
public class NetworkScannerPlugin extends Plugin {

    @PluginMethod
    public void getNetworkInfo(PluginCall call) {
        try {
            Context context = getContext();
            WifiManager wifiManager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifiManager == null) {
                call.reject("Wi-Fi Manager unavailable");
                return;
            }

            WifiInfo wifiInfo = wifiManager.getConnectionInfo();
            DhcpInfo dhcpInfo = wifiManager.getDhcpInfo();

            int ipAddress = wifiInfo.getIpAddress();
            String ipStr = Formatter.formatIpAddress(ipAddress);
            String gatewayStr = Formatter.formatIpAddress(dhcpInfo.gateway);
            String ssid = wifiInfo.getSSID().replace("\"", "");

            JSObject ret = new JSObject();
            ret.put("localIp", ipStr);
            ret.put("gateway", gatewayStr);
            ret.put("ssid", ssid);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Error fetching network info: " + e.getMessage());
        }
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        ExecutorService executor = Executors.newFixedThreadPool(30);
        try {
            Context context = getContext();
            WifiManager wifiManager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            DhcpInfo dhcpInfo = wifiManager.getDhcpInfo();
            String gatewayStr = Formatter.formatIpAddress(dhcpInfo.gateway);

            if (gatewayStr == null || gatewayStr.equals("0.0.0.0")) {
                call.reject("Not connected to a valid Wi-Fi network");
                return;
            }

            String[] parts = gatewayStr.split("\\.");
            String prefix = parts[0] + "." + parts[1] + "." + parts[2];

            Map<String, String> arpMap = readARPTable();
            JSArray devices = new JSArray();

            for (int i = 1; i <= 254; i++) {
                final String targetIp = prefix + "." + i;
                executor.execute(() -> {
                    try {
                        InetAddress addr = InetAddress.getByName(targetIp);
                        boolean reachable = addr.isReachable(400);

                        if (!reachable) {
                            // Secondary check on port 80/443
                            try (Socket socket = new Socket()) {
                                socket.connect(new java.net.InetSocketAddress(targetIp, 80), 300);
                                reachable = true;
                            } catch (IOException ignored) {}
                        }

                        if (reachable) {
                            JSObject dev = new JSObject();
                            dev.put("ip", targetIp);
                            dev.put("mac", arpMap.getOrDefault(targetIp, "—"));
                            dev.put("isGateway", targetIp.equals(gatewayStr));
                            dev.put("vendor", targetIp.equals(gatewayStr) ? "Router / Access Point" : "Network Device");

                            synchronized (devices) {
                                devices.put(dev);
                            }
                        }
                    } catch (Exception ignored) {}
                });
            }

            executor.shutdown();
            executor.awaitTermination(15, TimeUnit.SECONDS);

            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);

        } catch (Exception e) {
            call.reject("Scan error: " + e.getMessage());
        }
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
