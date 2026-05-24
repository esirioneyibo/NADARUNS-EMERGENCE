import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

type DocumentType = "license_front" | "license_back" | "selfie";

interface DocumentState {
  uri: string | null;
  status: "pending" | "uploading" | "uploaded" | "error";
}

export default function KYCScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  
  const [documents, setDocuments] = useState<Record<DocumentType, DocumentState>>({
    license_front: { uri: null, status: "pending" },
    license_back: { uri: null, status: "pending" },
    selfie: { uri: null, status: "pending" },
  });
  const [submitting, setSubmitting] = useState(false);

  const styles = createStyles(theme);

  const pickImage = async (type: DocumentType, useCamera: boolean = false) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    
    try {
      let result;
      
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission Required", "Camera access is needed to take photos.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: type === "selfie" ? [1, 1] : [4, 3],
          quality: 0.8,
          base64: true,
        });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission Required", "Photo library access is needed to select images.");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: type === "selfie" ? [1, 1] : [4, 3],
          quality: 0.8,
          base64: true,
        });
      }

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setDocuments((prev) => ({
          ...prev,
          [type]: { uri: asset.uri, status: "uploading" },
        }));

        // Simulate upload delay
        setTimeout(() => {
          setDocuments((prev) => ({
            ...prev,
            [type]: { uri: asset.uri, status: "uploaded" },
          }));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }, 1500);
      }
    } catch (error) {
      console.warn("Image picker error:", error);
      Alert.alert("Error", "Failed to capture image. Please try again.");
    }
  };

  const showImageOptions = (type: DocumentType) => {
    Alert.alert(
      type === "selfie" ? "Take Selfie" : "Upload Document",
      type === "selfie" 
        ? "Take a clear photo of your face" 
        : "Choose how to add your document",
      [
        { text: "Camera", onPress: () => pickImage(type, true) },
        { text: "Photo Library", onPress: () => pickImage(type, false) },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const allUploaded = Object.values(documents).every((d) => d.status === "uploaded");
  const anyUploading = Object.values(documents).some((d) => d.status === "uploading");

  const handleSubmit = async () => {
    if (!allUploaded) return;
    
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    // Simulate API submission
    setTimeout(() => {
      setSubmitting(false);
      Alert.alert(
        "Documents Submitted",
        "Your documents have been submitted for verification. This usually takes 1-2 business days.",
        [{ text: "OK", onPress: () => router.back() }]
      );
    }, 2000);
  };

  const DocumentCard = ({ 
    type, 
    title, 
    description, 
    icon 
  }: { 
    type: DocumentType; 
    title: string; 
    description: string; 
    icon: keyof typeof Ionicons.glyphMap;
  }) => {
    const doc = documents[type];
    const isUploaded = doc.status === "uploaded";
    const isUploading = doc.status === "uploading";

    return (
      <TouchableOpacity
        style={[styles.docCard, isUploaded && styles.docCardUploaded]}
        onPress={() => !isUploading && showImageOptions(type)}
        disabled={isUploading}
        testID={`doc-${type}`}
      >
        {doc.uri ? (
          <Image source={{ uri: doc.uri }} style={styles.docImage} />
        ) : (
          <View style={[styles.docPlaceholder, isUploaded && { backgroundColor: theme.primaryLight }]}>
            <Ionicons 
              name={icon} 
              size={32} 
              color={isUploaded ? theme.primary : theme.textSecondary} 
            />
          </View>
        )}
        
        <View style={styles.docInfo}>
          <Text style={styles.docTitle}>{title}</Text>
          <Text style={styles.docDesc}>{description}</Text>
        </View>

        {isUploading ? (
          <ActivityIndicator size="small" color={theme.primary} />
        ) : isUploaded ? (
          <View style={styles.checkBadge}>
            <Ionicons name="checkmark" size={16} color="#fff" />
          </View>
        ) : (
          <Ionicons name="camera-outline" size={24} color={theme.textSecondary} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="kyc-screen">
      <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
        <TouchableOpacity
          style={[styles.iconBtn, shadows.sm]}
          onPress={() => router.back()}
          testID="kyc-back-button"
        >
          <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>KYC Verification</Text>
        <View style={{ width: 44 }} />
      </Animated.View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Info card */}
        <Animated.View entering={FadeInUp.delay(80)} style={[styles.infoCard, shadows.sm]}>
          <View style={styles.infoIcon}>
            <Ionicons name="shield-checkmark" size={24} color={theme.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>Identity Verification</Text>
            <Text style={styles.infoText}>
              To ensure safety and comply with regulations, we need to verify your identity. 
              Please upload clear photos of your documents.
            </Text>
          </View>
        </Animated.View>

        {/* Progress */}
        <Animated.View entering={FadeInUp.delay(120)} style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <Animated.View 
              style={[
                styles.progressFill, 
                { width: `${(Object.values(documents).filter(d => d.status === "uploaded").length / 3) * 100}%` }
              ]} 
            />
          </View>
          <Text style={styles.progressText}>
            {Object.values(documents).filter(d => d.status === "uploaded").length} of 3 documents uploaded
          </Text>
        </Animated.View>

        {/* Document cards */}
        <Text style={styles.sectionTitle}>DRIVER'S LICENSE</Text>
        
        <Animated.View entering={FadeInUp.delay(160)}>
          <DocumentCard
            type="license_front"
            title="Front of License"
            description="Photo, name, and license number visible"
            icon="card-outline"
          />
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(200)}>
          <DocumentCard
            type="license_back"
            title="Back of License"
            description="Barcode and additional info visible"
            icon="card-outline"
          />
        </Animated.View>

        <Text style={styles.sectionTitle}>SELFIE VERIFICATION</Text>
        
        <Animated.View entering={FadeInUp.delay(240)}>
          <DocumentCard
            type="selfie"
            title="Take a Selfie"
            description="Clear photo of your face, well-lit"
            icon="person-circle-outline"
          />
        </Animated.View>

        {/* Tips */}
        <Animated.View entering={FadeInUp.delay(280)} style={[styles.tipsCard, shadows.sm]}>
          <Text style={styles.tipsTitle}>Tips for better photos</Text>
          <View style={styles.tipRow}>
            <Ionicons name="sunny-outline" size={18} color={theme.warning} />
            <Text style={styles.tipText}>Use good lighting</Text>
          </View>
          <View style={styles.tipRow}>
            <Ionicons name="scan-outline" size={18} color={theme.primary} />
            <Text style={styles.tipText}>Ensure all text is readable</Text>
          </View>
          <View style={styles.tipRow}>
            <Ionicons name="crop-outline" size={18} color={theme.success} />
            <Text style={styles.tipText}>Capture the entire document</Text>
          </View>
        </Animated.View>

        {/* Submit button */}
        <Animated.View entering={FadeInUp.delay(320)}>
          <TouchableOpacity
            style={[
              styles.submitBtn,
              (!allUploaded || anyUploading || submitting) && styles.submitBtnDisabled
            ]}
            onPress={handleSubmit}
            disabled={!allUploaded || anyUploading || submitting}
            testID="kyc-submit-button"
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={styles.submitBtnText}>Submit for Verification</Text>
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </>
            )}
          </TouchableOpacity>
        </Animated.View>

        <Text style={styles.noteText}>
          Verification typically takes 1-2 business days. You'll receive a notification once complete.
        </Text>
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  header: { 
    flexDirection: "row", 
    alignItems: "center", 
    justifyContent: "space-between", 
    paddingHorizontal: spacing.xl, 
    paddingVertical: spacing.md 
  },
  iconBtn: { 
    width: 44, 
    height: 44, 
    borderRadius: 22, 
    backgroundColor: theme.surface, 
    alignItems: "center", 
    justifyContent: "center" 
  },
  heading: { fontSize: 20, fontWeight: "800", color: theme.textPrimary, letterSpacing: -0.3 },
  
  infoCard: {
    backgroundColor: theme.primaryLight,
    borderRadius: radius.xl,
    padding: spacing.lg,
    flexDirection: "row",
    gap: 12,
    marginBottom: spacing.lg,
  },
  infoIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  infoTitle: { fontSize: 16, fontWeight: "700", color: theme.textPrimary, marginBottom: 4 },
  infoText: { fontSize: 13, color: theme.textSecondary, lineHeight: 18 },
  
  progressContainer: { marginBottom: spacing.xl },
  progressBar: {
    height: 6,
    backgroundColor: theme.surfaceMuted,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: theme.primary,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: theme.textSecondary,
    marginTop: 8,
    textAlign: "center",
  },
  
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: theme.textSecondary,
    letterSpacing: 1.2,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderColor: theme.border,
    gap: 12,
  },
  docCardUploaded: {
    borderColor: theme.success,
    backgroundColor: `${theme.success}08`,
  },
  docPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: theme.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  docImage: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: theme.surfaceMuted,
  },
  docInfo: { flex: 1 },
  docTitle: { fontSize: 15, fontWeight: "700", color: theme.textPrimary },
  docDesc: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
  checkBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.success,
    alignItems: "center",
    justifyContent: "center",
  },
  
  tipsCard: {
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  tipsTitle: { fontSize: 14, fontWeight: "700", color: theme.textPrimary, marginBottom: spacing.md },
  tipRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  tipText: { fontSize: 13, color: theme.textSecondary },
  
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.primary,
    paddingVertical: 18,
    borderRadius: radius.lg,
    marginTop: spacing.xl,
    gap: 8,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: "#fff", fontWeight: "800", fontSize: 17 },
  
  noteText: {
    fontSize: 12,
    color: theme.textSecondary,
    textAlign: "center",
    marginTop: spacing.lg,
    lineHeight: 18,
  },
});
