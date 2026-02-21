import React, {useEffect, useState} from "react";
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from "react-native";
import {initCactus} from "./src/cactus";
import {startTCPServer} from "./src/server";

const PORT = 6000;

function App(): React.JSX.Element {
  const [status, setStatus] = useState<string>("Starting...");
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timestamp}] ${message}`, ...prev].slice(0, 20));
  };

  useEffect(() => {
    (async () => {
      try {
        setStatus("Initializing Cactus + FunctionGemma...");
        addLog("Starting LFO Mobile");
        await initCactus();
        addLog("Model loaded successfully");

        setStatus("Starting TCP server...");
        startTCPServer();
        addLog(`TCP server listening on port ${PORT}`);

        setStatus(`✅ Ready on port ${PORT}`);
        addLog("LFO Mobile is ready to accept requests");
      } catch (error: any) {
        const errorMsg = error?.message ?? "Unknown error";
        setStatus(`❌ Error: ${errorMsg}`);
        addLog(`ERROR: ${errorMsg}`);
      }
    })();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <View style={styles.header}>
        <Text style={styles.title}>LFO Mobile</Text>
        <Text style={styles.subtitle}>Cactus + FunctionGemma</Text>
      </View>
      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Status</Text>
        <Text style={styles.statusText}>{status}</Text>
      </View>
      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>Configuration</Text>
        <Text style={styles.infoText}>Port: {PORT}</Text>
        <Text style={styles.infoText}>Model: function-gemma-270m.gguf</Text>
        <Text style={styles.infoText}>Context: 2048 tokens</Text>
      </View>
      <View style={styles.logsCard}>
        <Text style={styles.logsLabel}>Recent Activity</Text>
        <ScrollView style={styles.logsScroll}>
          {logs.map((log, index) => (
            <Text key={index} style={styles.logText}>
              {log}
            </Text>
          ))}
        </ScrollView>
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Ensure your Windows machine can reach this device on port {PORT}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: "#f5f5f5"},
  header: {backgroundColor: "#4a90e2", padding: 20, alignItems: "center"},
  title: {fontSize: 24, fontWeight: "bold", color: "#ffffff"},
  subtitle: {fontSize: 14, color: "#e0e0e0", marginTop: 4},
  statusCard: {
    margin: 16,
    padding: 16,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3
  },
  statusLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 8,
    textTransform: "uppercase",
    fontWeight: "600"
  },
  statusText: {fontSize: 16, color: "#333", fontWeight: "500"},
  infoCard: {
    margin: 16,
    marginTop: 0,
    padding: 16,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3
  },
  infoLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 8,
    textTransform: "uppercase",
    fontWeight: "600"
  },
  infoText: {fontSize: 14, color: "#333", marginVertical: 2},
  logsCard: {
    flex: 1,
    margin: 16,
    marginTop: 0,
    padding: 16,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3
  },
  logsLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 8,
    textTransform: "uppercase",
    fontWeight: "600"
  },
  logsScroll: {flex: 1},
  logText: {
    fontSize: 12,
    color: "#333",
    fontFamily: "monospace",
    marginVertical: 2
  },
  footer: {
    padding: 16,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0"
  },
  footerText: {fontSize: 12, color: "#666", textAlign: "center"}
});

export default App;
