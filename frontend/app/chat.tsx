import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";
import { useChat, ChatMessage } from "../src/hooks/useChat";

export default function ChatScreen() {
  const { orderId, userId, userType, userName } = useLocalSearchParams<{
    orderId: string;
    userId: string;
    userType: string;
    userName: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const flatListRef = useRef<FlatList>(null);
  
  const [inputText, setInputText] = useState("");

  const styles = createStyles(theme);

  const { isConnected, messages, unreadCount, sendMessage, markAsRead } = useChat({
    orderId: orderId || "",
    userId: userId || "",
    userType: (userType as "driver" | "shipper" | "customer") || "driver",
    userName: userName || "User",
    enabled: !!orderId && !!userId,
    onNewMessage: (message) => {
      // Scroll to bottom on new message
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    },
  });

  // Mark messages as read when viewing
  useEffect(() => {
    if (messages.length > 0) {
      const unreadIds = messages
        .filter((m) => !m.read && m.sender_id !== userId)
        .map((m) => m.id);
      if (unreadIds.length > 0) {
        markAsRead(unreadIds);
      }
    }
  }, [messages, userId, markAsRead]);

  // Scroll to bottom on load
  useEffect(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: false });
    }, 300);
  }, []);

  const handleSend = () => {
    if (!inputText.trim()) return;
    sendMessage(inputText);
    setInputText("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isMe = item.sender_id === userId;
    const showAvatar = index === 0 || messages[index - 1]?.sender_id !== item.sender_id;
    
    return (
      <Animated.View
        entering={FadeInUp.delay(index * 30).duration(200)}
        style={[
          styles.messageRow,
          isMe ? styles.messageRowMe : styles.messageRowOther,
        ]}
      >
        {!isMe && showAvatar && (
          <View style={styles.avatarContainer}>
            <View style={[styles.avatar, { backgroundColor: getAvatarColor(item.sender_type) }]}>
              <Ionicons
                name={item.sender_type === "driver" ? "bicycle" : "storefront"}
                size={14}
                color="#fff"
              />
            </View>
          </View>
        )}
        {!isMe && !showAvatar && <View style={styles.avatarPlaceholder} />}
        
        <View style={[styles.messageBubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
          {!isMe && showAvatar && (
            <Text style={styles.senderName}>{item.sender_name}</Text>
          )}
          <Text style={[styles.messageText, isMe && styles.messageTextMe]}>
            {item.message}
          </Text>
          <Text style={[styles.messageTime, isMe && styles.messageTimeMe]}>
            {formatTime(item.timestamp)}
          </Text>
        </View>
      </Animated.View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
        <TouchableOpacity
          style={[styles.iconBtn, shadows.sm]}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Chat</Text>
          <View style={styles.connectionStatus}>
            <View style={[styles.statusDot, { backgroundColor: isConnected ? "#10B981" : "#EF4444" }]} />
            <Text style={styles.statusText}>{isConnected ? "Connected" : "Reconnecting..."}</Text>
          </View>
        </View>
        <View style={{ width: 44 }} />
      </Animated.View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messagesList}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles-outline" size={48} color={theme.textSecondary} />
            <Text style={styles.emptyText}>No messages yet</Text>
            <Text style={styles.emptySubtext}>Start the conversation!</Text>
          </View>
        }
      />

      {/* Input */}
      <View style={[styles.inputContainer, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor={theme.textSecondary}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim()}
          >
            <Ionicons name="send" size={20} color={inputText.trim() ? "#fff" : theme.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function getAvatarColor(senderType: string): string {
  switch (senderType) {
    case "driver":
      return "#10B981";
    case "shipper":
      return "#6366F1";
    default:
      return "#F59E0B";
  }
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { alignItems: "center" },
  headerTitle: { fontSize: 18, fontWeight: "800", color: theme.textPrimary },
  connectionStatus: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, color: theme.textSecondary },

  messagesList: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  
  messageRow: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  messageRowMe: {
    justifyContent: "flex-end",
  },
  messageRowOther: {
    justifyContent: "flex-start",
  },
  
  avatarContainer: {
    marginRight: 8,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPlaceholder: {
    width: 28,
    marginRight: 8,
  },
  
  messageBubble: {
    maxWidth: "75%",
    padding: spacing.md,
    borderRadius: radius.xl,
  },
  bubbleMe: {
    backgroundColor: theme.primary,
    borderBottomRightRadius: radius.sm,
  },
  bubbleOther: {
    backgroundColor: theme.surface,
    borderBottomLeftRadius: radius.sm,
  },
  
  senderName: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.textSecondary,
    marginBottom: 4,
  },
  messageText: {
    fontSize: 15,
    color: theme.textPrimary,
    lineHeight: 20,
  },
  messageTextMe: {
    color: "#fff",
  },
  messageTime: {
    fontSize: 10,
    color: theme.textSecondary,
    marginTop: 4,
    alignSelf: "flex-end",
  },
  messageTimeMe: {
    color: "rgba(255,255,255,0.7)",
  },
  
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.textPrimary,
    marginTop: spacing.md,
  },
  emptySubtext: {
    fontSize: 13,
    color: theme.textSecondary,
    marginTop: 4,
  },
  
  inputContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.background,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    fontSize: 15,
    color: theme.textPrimary,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: theme.border,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    backgroundColor: theme.surfaceMuted,
  },
});
