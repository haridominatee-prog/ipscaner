package com.domscanner.app;

import android.Manifest;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.DhcpInfo;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
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
import java.io.InputStreamReader;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.Socket;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@CapacitorPlugin(
    name = "NetworkScanner",
    permissions = {
        @Permission(
            alias = "network",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_WIFI_STATE,
                Manifest.permission.NEARBY_WIFI_DEVICES
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
            String ssid = getSsidStr(wifiInfo, dhcpInfo);
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
        WifiManager.MulticastLock multicastLock = null;
        try {
            Context context = getContext();
            WifiManager wifiManager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            DhcpInfo dhcpInfo = wifiManager != null ? wifiManager.getDhcpInfo() : null;
            WifiInfo wifiInfo = wifiManager != null ? wifiManager.getConnectionInfo() : null;

            if (wifiManager != null) {
                try {
                    multicastLock = wifiManager.createMulticastLock("DOMScannerMDNS");
                    multicastLock.setReferenceCounted(true);
                    multicastLock.acquire();
                } catch (Exception ignored) {}
            }

            String gatewayStr = getGatewayIpStr(dhcpInfo);
            String myIp = getLocalIpStr(wifiInfo);
            String prefix = getSubnetPrefix(gatewayStr);

            Map<String, String> mdnsMap = scanMDNSHostnames();
            Map<String, String> arpMap = readARPTable();
            JSArray devices = new JSArray();
            AtomicInteger scannedCount = new AtomicInteger(0);
            AtomicInteger foundCount = new AtomicInteger(0);

            int totalTargetIps = 254;

            for (int i = 1; i <= 254; i++) {
                final String targetIp = prefix + "." + i;
                executor.execute(() -> {
                    long startTime = System.currentTimeMillis();
                    boolean reachable = false;
                    List<Integer> openPortsList = new ArrayList<>();
                    long responseTimeMs = -1;

                    try {
                        InetAddress addr = InetAddress.getByName(targetIp);
                        reachable = addr.isReachable(300);
                        if (reachable) {
                            responseTimeMs = System.currentTimeMillis() - startTime;
                        }

                        int[] probePorts = {80, 443, 8080, 22, 139, 445, 53, 3389, 8000, 5000, 8888, 1900};
                        for (int port : probePorts) {
                            long pStart = System.currentTimeMillis();
                            try (Socket socket = new Socket()) {
                                socket.connect(new InetSocketAddress(targetIp, port), 200);
                                reachable = true;
                                if (responseTimeMs < 0) {
                                    responseTimeMs = System.currentTimeMillis() - pStart;
                                }
                                openPortsList.add(port);
                            } catch (IOException ignored) {}
                        }

                        if (reachable) {
                            foundCount.incrementAndGet();
                            boolean isGw = targetIp.equals(gatewayStr);
                            boolean isMe = targetIp.equals(myIp);

                            NetBIOSResult netbios = queryNetBIOS(targetIp);
                            String mdnsHost = mdnsMap.get(targetIp);
                            String rawHostname = mdnsHost != null ? mdnsHost : (netbios.hostname != null ? netbios.hostname : getReverseDnsHostname(addr));
                            String rawMac = !netbios.mac.equals("—") ? netbios.mac : arpMap.getOrDefault(targetIp, "—");
                            String rawVendor = isGw ? "Router / Access Point" : (isMe ? "This Mobile Phone" : getVendorFromMac(rawMac));

                            JSObject dev = new JSObject();
                            dev.put("ip", targetIp);
                            dev.put("mac", rawMac.equals("—") ? "Not available on Android" : rawMac);
                            dev.put("hostname", rawHostname != null ? rawHostname : "Not discovered");
                            dev.put("vendor", rawVendor.equals("Unknown") || rawVendor.equals("Network Device") ? "Not discovered" : rawVendor);
                            dev.put("isGateway", isGw);
                            dev.put("isMe", isMe);
                            dev.put("status", "Online (" + (responseTimeMs > 0 ? responseTimeMs : 15) + " ms)");
                            dev.put("responseTimeMs", responseTimeMs > 0 ? responseTimeMs : 15);
                            dev.put("openPorts", listToJSArray(openPortsList));
                            dev.put("servicesFormatted", formatServicesList(openPortsList));

                            if (openPortsList.contains(80) || openPortsList.contains(8080) || openPortsList.contains(8000) || openPortsList.contains(5000) || openPortsList.contains(8888)) {
                                enrichHttpDevice(targetIp, openPortsList, dev);
                            }

                            String finalVendor = dev.getString("vendor");
                            String finalHostname = dev.getString("hostname");
                            String confidence = calculateConfidence(isGw, isMe, rawMac, finalVendor, finalHostname, openPortsList);
                            dev.put("confidence", confidence);
                            dev.put("deviceType", getDeviceTypeObj(isGw, isMe, finalVendor, openPortsList, finalHostname));

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

            executor.shutdown();
            executor.awaitTermination(15, TimeUnit.SECONDS);

            JSObject ret = new JSObject();
            ret.put("devices", devices);
            ret.put("totalFound", foundCount.get());
            call.resolve(ret);

        } catch (Exception e) {
            call.reject("Scan error: " + e.getMessage());
        } finally {
            if (multicastLock != null && multicastLock.isHeld()) {
                try { multicastLock.release(); } catch (Exception ignored) {}
            }
        }
    }

    private Map<String, String> scanMDNSHostnames() {
        Map<String, String> map = new ConcurrentHashMap<>();
        try {
            InetAddress group = InetAddress.getByName("224.0.0.251");
            MulticastSocket socket = new MulticastSocket(5353);
            socket.setSoTimeout(1000);
            socket.joinGroup(group);

            byte[] query = new byte[] {
                0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x09, '_', 's', 'e', 'r', 'v', 'i', 'c', 'e', 's',
                0x07, '_', 'd', 'n', 's', '-', 's', 'd',
                0x04, '_', 'u', 'd', 'p', 0x05, 'l', 'o', 'c', 'a', 'l', 0x00,
                0x00, 0x0C, 0x00, 0x01,
                0x05, '_', 'h', 't', 't', 'p', 0x04, '_', 't', 'c', 'p', 0x05, 'l', 'o', 'c', 'a', 'l', 0x00,
                0x00, 0x0C, 0x00, 0x01
            };

            DatagramPacket packet = new DatagramPacket(query, query.length, group, 5353);
            socket.send(packet);

            long endTime = System.currentTimeMillis() + 1000;
            byte[] buf = new byte[1500];

            while (System.currentTimeMillis() < endTime) {
                try {
                    DatagramPacket resp = new DatagramPacket(buf, buf.length);
                    socket.receive(resp);
                    String senderIp = resp.getAddress().getHostAddress();
                    String str = new String(resp.getData(), 0, resp.getLength());

                    Pattern p = Pattern.compile("([a-zA-Z0-9\\-_]+\\.local)");
                    Matcher m = p.matcher(str);
                    if (m.find()) {
                        String host = m.group(1);
                        if (!host.contains("_services") && !host.contains("_http") && !host.contains("_tcp")) {
                            map.put(senderIp, host);
                        }
                    }
                } catch (IOException ignored) {
                    break;
                }
            }

            socket.leaveGroup(group);
            socket.close();
        } catch (Exception ignored) {}
        return map;
    }

    private String calculateConfidence(boolean isGw, boolean isMe, String mac, String vendor, String hostname, List<Integer> ports) {
        if (isGw || isMe) return "High (95%)";
        boolean hasMac = mac != null && !mac.startsWith("Not");
        boolean hasHost = hostname != null && !hostname.startsWith("Not");
        boolean hasVendor = vendor != null && !vendor.startsWith("Not");
        boolean hasPorts = ports != null && !ports.isEmpty();

        if (hasMac && (hasHost || hasVendor)) return "High (90%)";
        if (hasHost || hasVendor) return "High (85%)";
        if (hasPorts) return "Medium (70%)";
        return "Low (40%)";
    }

    private String formatServicesList(List<Integer> ports) {
        if (ports == null || ports.isEmpty()) return "None detected";
        List<String> list = new ArrayList<>();
        for (int p : ports) {
            if (p == 80) list.add("80 (HTTP)");
            else if (p == 443) list.add("443 (HTTPS)");
            else if (p == 22) list.add("22 (SSH)");
            else if (p == 139 || p == 445) list.add(p + " (SMB/NetBIOS)");
            else if (p == 3389) list.add("3389 (RDP)");
            else if (p == 8080 || p == 8000 || p == 5000 || p == 8888) list.add(p + " (Web/App Server)");
            else list.add(String.valueOf(p));
        }
        return String.join(", ", list);
    }

    private void enrichHttpDevice(String ip, List<Integer> openPorts, JSObject dev) {
        int targetPort = openPorts.contains(5000) ? 5000 : (openPorts.contains(80) ? 80 : (openPorts.contains(8080) ? 8080 : 8000));
        try {
            URL url = new URL("http://" + ip + ":" + targetPort + "/");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(600);
            conn.setReadTimeout(600);
            conn.setRequestMethod("GET");
            int code = conn.getResponseCode();
            if (code >= 200 && code < 400) {
                try (BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                    StringBuilder sb = new StringBuilder();
                    String line;
                    int count = 0;
                    while ((line = in.readLine()) != null && count++ < 25) {
                        sb.append(line);
                    }
                    String html = sb.toString();
                    Pattern p = Pattern.compile("<title[^>]*>(.*?)</title>", Pattern.CASE_INSENSITIVE);
                    Matcher m = p.matcher(html);
                    if (m.find()) {
                        String title = m.group(1).trim();
                        if (!title.isEmpty() && title.length() < 60 && !title.toLowerCase().contains("404") && !title.toLowerCase().contains("error")) {
                            dev.put("hostname", title);
                            String parsedBrand = parseVendorFromTitle(title);
                            if (parsedBrand != null) {
                                dev.put("vendor", parsedBrand);
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    private String parseVendorFromTitle(String title) {
        String t = title.toLowerCase(Locale.US);
        if (t.contains("tp-link") || t.contains("tplink")) return "TP-Link Router";
        if (t.contains("d-link") || t.contains("dlink")) return "D-Link Router";
        if (t.contains("asus")) return "ASUS Router";
        if (t.contains("netgear")) return "Netgear Router";
        if (t.contains("openwrt")) return "OpenWrt Router";
        if (t.contains("samsung")) return "Samsung Smart Device";
        if (t.contains("hikvision")) return "Hikvision IP Camera / DVR";
        if (t.contains("dahua")) return "Dahua IP Camera / DVR";
        if (t.contains("canon")) return "Canon Printer";
        if (t.contains("epson")) return "Epson Printer";
        if (t.contains("hp ")) return "HP Printer / Device";
        if (t.contains("octoprint")) return "OctoPrint 3D Printer";
        if (t.contains("synology") || t.contains("diskstation")) return "Synology NAS";
        if (t.contains("home assistant")) return "Home Assistant Hub";
        return null;
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

    private static class NetBIOSResult {
        String hostname = null;
        String mac = "—";
    }

    private NetBIOSResult queryNetBIOS(String ip) {
        NetBIOSResult res = new NetBIOSResult();
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setSoTimeout(300);
            byte[] query = new byte[] {
                (byte) 0x82, (byte) 0x28, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x20, 0x43, 0x4B, 0x41,
                0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41,
                0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41,
                0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41,
                0x41, 0x41, 0x41, 0x41, 0x41, 0x00, 0x00, 0x21, 0x00, 0x01
            };
            InetAddress target = InetAddress.getByName(ip);
            DatagramPacket packet = new DatagramPacket(query, query.length, target, 137);
            socket.send(packet);

            byte[] buffer = new byte[1024];
            DatagramPacket resp = new DatagramPacket(buffer, buffer.length);
            socket.receive(resp);

            if (resp.getLength() > 56) {
                byte[] data = resp.getData();
                int numNames = data[56] & 0xFF;
                if (numNames > 0 && resp.getLength() >= 57 + 18) {
                    byte[] nameBytes = new byte[15];
                    System.arraycopy(data, 57, nameBytes, 0, 15);
                    String name = new String(nameBytes).trim();
                    if (!name.isEmpty()) {
                        res.hostname = name;
                    }
                    int macOffset = 57 + (numNames * 18);
                    if (resp.getLength() >= macOffset + 6) {
                        res.mac = String.format("%02x:%02x:%02x:%02x:%02x:%02x",
                            data[macOffset], data[macOffset + 1], data[macOffset + 2],
                            data[macOffset + 3], data[macOffset + 4], data[macOffset + 5]);
                    }
                }
            }
        } catch (Exception ignored) {}
        return res;
    }

    private String getReverseDnsHostname(InetAddress addr) {
        try {
            String canonical = addr.getCanonicalHostName();
            if (canonical != null && !canonical.equalsIgnoreCase(addr.getHostAddress())) {
                return canonical;
            }
        } catch (Exception ignored) {}
        return null;
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

    private String getSsidStr(WifiInfo wifiInfo, DhcpInfo dhcpInfo) {
        if (wifiInfo != null && wifiInfo.getSSID() != null) {
            String ssid = wifiInfo.getSSID().replace("\"", "");
            if (!ssid.isEmpty() && !ssid.equals("<unknown ssid>")) {
                return ssid;
            }
        }
        try {
            Context context = getContext();
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                Network activeNet = cm.getActiveNetwork();
                if (activeNet != null) {
                    NetworkCapabilities nc = cm.getNetworkCapabilities(activeNet);
                    if (nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                        WifiInfo info = (WifiInfo) nc.getTransportInfo();
                        if (info != null && info.getSSID() != null) {
                            String ssid = info.getSSID().replace("\"", "");
                            if (!ssid.isEmpty() && !ssid.equals("<unknown ssid>")) {
                                return ssid;
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {}

        String gw = getGatewayIpStr(dhcpInfo);
        return "Wi-Fi Network (" + getSubnetPrefix(gw) + ".x)";
    }

    private String getSubnetPrefix(String ip) {
        if (ip == null || !ip.contains(".")) return "192.168.1";
        String[] parts = ip.split("\\.");
        return parts[0] + "." + parts[1] + "." + parts[2];
    }

    private String getVendorFromMac(String mac) {
        if (mac == null || mac.equals("—") || mac.startsWith("Not") || mac.length() < 8) return "Not discovered";
        String p = mac.toUpperCase(Locale.US).substring(0, 8);

        if (p.startsWith("B8:27:EB") || p.startsWith("DC:A6:32") || p.startsWith("E4:5F:01") || p.startsWith("D8:3A:DD") || p.startsWith("2C:CF:67")) return "Raspberry Pi";
        if (p.startsWith("3C:22:FB") || p.startsWith("F4:0F:24") || p.startsWith("AC:D1:B8") || p.startsWith("00:1C:B3") || p.startsWith("9C:20:7B") || p.startsWith("F0:18:98") || p.startsWith("60:F8:1D") || p.startsWith("A8:51:AB") || p.startsWith("80:E6:50") || p.startsWith("DC:A9:04") || p.startsWith("A0:99:9B")) return "Apple";
        if (p.startsWith("F8:16:54") || p.startsWith("00:12:47") || p.startsWith("08:37:3D") || p.startsWith("E8:50:8B") || p.startsWith("48:13:7E") || p.startsWith("5C:E0:F6") || p.startsWith("8C:71:F4") || p.startsWith("CC:07:AB") || p.startsWith("28:18:78")) return "Samsung";
        if (p.startsWith("00:1A:11") || p.startsWith("F4:F5:D8") || p.startsWith("54:60:09") || p.startsWith("A4:C3:F0") || p.startsWith("D8:6C:63") || p.startsWith("94:EB:CD") || p.startsWith("3C:5A:B4")) return "Google";
        if (p.startsWith("64:09:80") || p.startsWith("28:6C:07") || p.startsWith("18:59:36") || p.startsWith("7C:1D:D9") || p.startsWith("D4:61:9D") || p.startsWith("54:48:E6")) return "Xiaomi";
        if (p.startsWith("00:1E:10") || p.startsWith("48:46:FB") || p.startsWith("20:F4:1B") || p.startsWith("80:7A:BF") || p.startsWith("70:8A:09") || p.startsWith("CC:A2:23")) return "Huawei";
        if (p.startsWith("B4:E6:2D") || p.startsWith("C0:4A:00") || p.startsWith("50:C7:BF") || p.startsWith("30:DE:4B") || p.startsWith("70:48:0F") || p.startsWith("EC:F0:0E") || p.startsWith("E8:48:B8") || p.startsWith("14:CC:20")) return "TP-Link";
        if (p.startsWith("00:50:7F") || p.startsWith("1C:AF:F7") || p.startsWith("00:17:9A") || p.startsWith("C8:D3:A3")) return "D-Link";
        if (p.startsWith("A4:2B:8C") || p.startsWith("20:4E:7F") || p.startsWith("00:1F:33") || p.startsWith("E0:46:9A")) return "Netgear";
        if (p.startsWith("C8:D3:A3") || p.startsWith("00:11:2F") || p.startsWith("04:D4:C4") || p.startsWith("AC:9E:17")) return "ASUS";
        if (p.startsWith("00:0F:66") || p.startsWith("00:18:39") || p.startsWith("00:25:84") || p.startsWith("48:8D:36")) return "Cisco / Linksys";
        if (p.startsWith("00:13:A9") || p.startsWith("00:19:C5") || p.startsWith("00:24:BE") || p.startsWith("30:F3:3A")) return "Sony";
        if (p.startsWith("00:1C:62") || p.startsWith("00:1E:B2") || p.startsWith("10:68:3F") || p.startsWith("A8:23:FE")) return "LG";
        if (p.startsWith("24:0A:C4") || p.startsWith("30:AE:A4") || p.startsWith("3C:71:BF") || p.startsWith("EC:FA:BC") || p.startsWith("94:B9:7E") || p.startsWith("84:F3:EB") || p.startsWith("CC:50:E3")) return "Espressif (ESP32)";
        if (p.startsWith("8C:8D:28") || p.startsWith("A0:A8:CD") || p.startsWith("8C:EC:4B") || p.startsWith("00:A0:C9") || p.startsWith("00:1E:65") || p.startsWith("3C:52:82")) return "Intel";
        if (p.startsWith("00:E0:4C") || p.startsWith("52:54:00")) return "Realtek";
        if (p.startsWith("00:50:F2") || p.startsWith("28:18:78") || p.startsWith("7C:1E:52") || p.startsWith("00:17:3F") || p.startsWith("00:15:5D")) return "Microsoft";
        if (p.startsWith("74:C2:46") || p.startsWith("44:65:0D") || p.startsWith("AC:63:BE") || p.startsWith("68:54:5A") || p.startsWith("F0:D2:F1") || p.startsWith("FC:A6:67")) return "Amazon Echo / Fire TV";
        if (p.startsWith("70:89:76") || p.startsWith("18:69:D8") || p.startsWith("D8:0D:17") || p.startsWith("50:02:91") || p.startsWith("D4:A6:42")) return "Tuya Smart Device";

        return "Not discovered";
    }

    private JSObject getDeviceTypeObj(boolean isGw, boolean isMe, String vendor, List<Integer> openPorts, String hostname) {
        JSObject obj = new JSObject();
        String v = vendor != null ? vendor.toLowerCase(Locale.US) : "";
        String h = hostname != null ? hostname.toLowerCase(Locale.US) : "";

        if (isGw || v.contains("tp-link") || v.contains("d-link") || v.contains("asus") || v.contains("netgear") || v.contains("cisco")) {
            obj.put("type", "router");
            obj.put("label", isGw ? "Gateway Router" : "Router / Access Point");
            obj.put("icon", "router");
        } else if (isMe) {
            obj.put("type", "phone");
            obj.put("label", "This Mobile Device");
            obj.put("icon", "phone");
        } else if (v.contains("apple") || h.contains("iphone") || h.contains("ipad") || h.contains("macbook")) {
            obj.put("type", "apple");
            obj.put("label", "Apple Device");
            obj.put("icon", "apple");
        } else if (v.contains("samsung")) {
            obj.put("type", "phone");
            obj.put("label", "Samsung Device");
            obj.put("icon", "phone");
        } else if (v.contains("google") || h.contains("chromecast")) {
            obj.put("type", "google");
            obj.put("label", "Google Device");
            obj.put("icon", "google");
        } else if (v.contains("raspberry") || h.contains("raspberry") || h.contains("armbian") || h.contains("orangepi")) {
            obj.put("type", "sbc");
            obj.put("label", "Raspberry Pi / SBC");
            obj.put("icon", "sbc");
        } else if (v.contains("espressif") || v.contains("tuya")) {
            obj.put("type", "iot");
            obj.put("label", "IoT Smart Device");
            obj.put("icon", "iot");
        } else if (v.contains("microsoft") || openPorts.contains(3389)) {
            obj.put("type", "windows");
            obj.put("label", "Windows PC");
            obj.put("icon", "windows");
        } else if (openPorts.contains(22)) {
            obj.put("type", "linux");
            obj.put("label", "Linux Server / Device");
            obj.put("icon", "linux");
        } else if (openPorts.contains(9100) || openPorts.contains(515) || openPorts.contains(631)) {
            obj.put("type", "printer");
            obj.put("label", "Network Printer");
            obj.put("icon", "printer");
        } else {
            obj.put("type", "unknown");
            obj.put("label", "Network Device");
            obj.put("icon", "unknown");
        }
        return obj;
    }

    private JSArray listToJSArray(List<Integer> list) {
        JSArray arr = new JSArray();
        if (list != null) {
            for (int val : list) arr.put(val);
        }
        return arr;
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
