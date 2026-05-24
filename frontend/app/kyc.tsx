import React, { useEffect, useState, useCallback } from "react";
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
import Animated, { FadeInDown, FadeInUp, FadeIn } from "react-native-reanimated";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

import { api } from "../src/api";
import { radius, shadows, spacing } from "../src/theme";
import { useTheme } from "../src/contexts/ThemeContext";

type DocumentType = "license_front" | "license_back" | "selfie";
type OverallStatus = "incomplete" | "pending" | "approved" | "rejected";
type DocStatus = "pending" | "uploading" | "uploaded" | "approved" | "rejected" | "error" | null;

interface DocumentState {
  uri: string | null;
  status: DocStatus;
}

// Document Card component - defined outside to avoid recreation
function DocumentCard({ 
  type, 
  title, 
  description, 
  icon,
  doc,
  onPress,
  theme,
  styles,
}: { 
  type: string; 
  title: string; 
  description: string; 
  icon: keyof typeof Ionicons.glyphMap;
  doc: DocumentState;
  onPress: () => void;
  theme: any;
  styles: any;
}) {
  const isUploaded = doc.status === "uploaded";
  const isUploading = doc.status === "uploading";

  return (
    <TouchableOpacity
      style={[styles.docCard, isUploaded && styles.docCardUploaded]}
      onPress={() => !isUploading && onPress()}
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
}

export default function KYCScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  
  const [documents, setDocuments] = useState<Record<DocumentType, DocumentState>>({
    license_front: { uri: null, status: null },
    license_back: { uri: null, status: null },
    selfie: { uri: null, status: null },
  });
  const [overallStatus, setOverallStatus] = useState<OverallStatus>("incomplete");
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [reviewedAt, setReviewedAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const styles = createStyles(theme);

  // Load existing KYC status
  const loadKYCStatus = useCallback(async () => {
    try {
      const status = await api.getKYCStatus();
      setDocuments({
        license_front: { 
          uri: null, 
          status: (status.license_front as DocStatus) || null
        },
        license_back: { 
          uri: null, 
          status: (status.license_back as DocStatus) || null
        },
        selfie: { 
          uri: null, 
          status: (status.selfie as DocStatus) || null
        },
      });
      setOverallStatus((status.overall_status as OverallStatus) || "incomplete");
      setSubmittedAt(status.submitted_at);
      setReviewedAt(status.reviewed_at);
    } catch (e) {
      console.warn("Failed to load KYC status", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKYCStatus();
  }, [loadKYCStatus]);

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
          [type]: { uri: asset.uri, status: "uploading" as DocStatus },
        }));

        try {
          const imageData = asset.base64 
            ? `data:image/jpeg;base64,${asset.base64}`
            : asset.uri;
          
          await api.uploadKYCDocument(type, imageData);
          
          setDocuments((prev) => ({
            ...prev,
            [type]: { uri: asset.uri, status: "uploaded" as DocStatus },
          }));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } catch (error) {
          console.warn("Upload failed:", error);
          setDocuments((prev) => ({
            ...prev,
            [type]: { uri: asset.uri, status: "error" as DocStatus },
          }));
          Alert.alert("Upload Failed", "Please try again.");
        }
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

  const anyUploading = Object.values(documents).some((d) => d.status === "uploading");
  const hasAllNewUploads = Object.values(documents).every((d) => d.status === "uploaded");

  const handleSubmit = async () => {
    if (!hasAllNewUploads) return;
    
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    try {
      await api.simulateKYCApproval();
      
      Alert.alert(
        "Documents Submitted",
        "Your documents have been submitted for verification. This usually takes 1-2 business days.",
        [{ text: "OK", onPress: () => loadKYCStatus() }]
      );
    } catch (error) {
      console.warn("Submit failed:", error);
      Alert.alert("Error", "Failed to submit documents. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const isAlreadySubmitted = overallStatus === "pending" || overallStatus === "approved";
  const isRejected = overallStatus === "rejected";

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  // ALREADY SUBMITTED / PENDING VERIFICATION VIEW
  if (isAlreadySubmitted) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]} testID="kyc-screen-submitted">
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

        <View style={styles.centeredContent}>
          <Animated.View entering={FadeIn.delay(100)} style={styles.statusCard}>
            <View style={[
              styles.statusIconLarge, 
              { backgroundColor: overallStatus === "approved" ? `${theme.success}15` : `${theme.warning}15` }
            ]}>
              <Ionicons 
                name={overallStatus === "approved" ? "checkmark-circle" : "time"} 
                size={64} 
                color={overallStatus === "approved" ? theme.success : theme.warning} 
              />
            </View>
            
            <Text style={styles.statusTitle}>
              {overallStatus === "approved" 
                ? "Verification Complete" 
                : "Verification In Progress"}
            </Text>
            
            <Text style={styles.statusDescription}>
              {overallStatus === "approved" 
                ? "Your documents have been verified. You're all set to start delivering!"
                : "Your documents have been submitted and are being reviewed. This usually takes 1-2 business days."}
            </Text>

            {submittedAt && (
              <View style={styles.statusMeta}>
                <Ionicons name="calendar-outline" size={16} color={theme.textSecondary} />
                <Text style={styles.statusMetaText}>
                  Submitted: {new Date(submittedAt).toLocaleDateString()}
                </Text>
              </View>
            )}

            {reviewedAt && overallStatus === "approved" && (
              <View style={styles.statusMeta}>
                <Ionicons name="checkmark-done" size={16} color={theme.success} />
                <Text style={[styles.statusMetaText, { color: theme.success }]}>
                  Approved: {new Date(reviewedAt).toLocaleDateString()}
                </Text>
              </View>
            )}
          </Animated.View>

          <Animated.View entering={FadeIn.delay(200)} style={[styles.docSummaryCard, shadows.sm]}>
            <Text style={styles.docSummaryTitle}>Document Status</Text>
            
            <View style={styles.docSummaryRow}>
              <View style={styles.docSummaryItem}>
                <Ionicons 
                  name={documents.license_front.status === "approved" ? "checkmark-circle" : "time-outline"} 
                  size={20} 
                  color={documents.license_front.status === "approved" ? theme.success : theme.warning} 
                />
                <Text style={styles.docSummaryText}>License Front</Text>
              </View>
              
              <View style={styles.docSummaryItem}>
                <Ionicons 
                  name={documents.license_back.status === "approved" ? "checkmark-circle" : "time-outline"} 
                  size={20} 
                  color={documents.license_back.status === "approved" ? theme.success : theme.warning} 
                />
                <Text style={styles.docSummaryText}>License Back</Text>
              </View>
              
              <View style={styles.docSummaryItem}>
                <Ionicons 
                  name={documents.selfie.status === "approved" ? "checkmark-circle" : "time-outline"} 
                  size={20} 
                  color={documents.selfie.status === "approved" ? theme.success : theme.warning} 
                />
                <Text style={styles.docSummaryText}>Selfie</Text>
              </View>
            </View>
          </Animated.View>

          <TouchableOpacity
            style={styles.backHomeBtn}
            onPress={() => router.back()}
            testID="kyc-back-home-button"
          >
            <Ionicons name="home-outline" size={20} color={theme.primary} />
            <Text style={styles.backHomeBtnText}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // REJECTED VIEW - Allow resubmission
  if (isRejected) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]} testID="kyc-screen-rejected">
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
          <Animated.View entering={FadeInUp.delay(80)} style={[styles.rejectionCard, shadows.sm]}>
            <View style={styles.rejectionIcon}>
              <Ionicons name="alert-circle" size={32} color={theme.error} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rejectionTitle}>Documents Rejected</Text>
              <Text style={styles.rejectionText}>
                Your documents could not be verified. Please resubmit clear photos of your documents.
              </Text>
            </View>
          </Animated.View>

          <Text style={styles.sectionTitle}>RESUBMIT DOCUMENTS</Text>
          
          <Animated.View entering={FadeInUp.delay(160)}>
            <DocumentCard
              type="license_front"
              title="Front of License"
              description="Photo, name, and license number visible"
              icon="card-outline"
              doc={documents.license_front}
              onPress={() => showImageOptions("license_front")}
              theme={theme}
              styles={styles}
            />
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(200)}>
            <DocumentCard
              type="license_back"
              title="Back of License"
              description="Barcode and additional info visible"
              icon="card-outline"
              doc={documents.license_back}
              onPress={() => showImageOptions("license_back")}
              theme={theme}
              styles={styles}
            />
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(240)}>
            <DocumentCard
              type="selfie"
              title="Take a Selfie"
              description="Clear photo of your face, well-lit"
              icon="person-circle-outline"
              doc={documents.selfie}
              onPress={() => showImageOptions("selfie")}
              theme={theme}
              styles={styles}
            />
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(320)}>
            <TouchableOpacity
              style={[
                styles.submitBtn,
                (!hasAllNewUploads || anyUploading || submitting) && styles.submitBtnDisabled
              ]}
              onPress={handleSubmit}
              disabled={!hasAllNewUploads || anyUploading || submitting}
              testID="kyc-resubmit-button"
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.submitBtnText}>Resubmit for Verification</Text>
                  <Ionicons name="arrow-forward" size={20} color="#fff" />
                </>
              )}
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </View>
    );
  }

  // INITIAL UPLOAD VIEW (incomplete status)
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

        <Text style={styles.sectionTitle}>DRIVER'S LICENSE</Text>
        
        <Animated.View entering={FadeInUp.delay(160)}>
          <DocumentCard
            type="license_front"
            title="Front of License"
            description="Photo, name, and license number visible"
            icon="card-outline"
            doc={documents.license_front}
            onPress={() => showImageOptions("license_front")}
            theme={theme}
            styles={styles}
          />
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(200)}>
          <DocumentCard
            type="license_back"
            title="Back of License"
            description="Barcode and additional info visible"
            icon="card-outline"
            doc={documents.license_back}
            onPress={() => showImageOptions("license_back")}
            theme={theme}
            styles={styles}
          />
        </Animated.View>

        <Text style={styles.sectionTitle}>SELFIE VERIFICATION</Text>
        
        <Animated.View entering={FadeInUp.delay(240)}>
          <DocumentCard
            type="selfie"
            title="Take a Selfie"
            description="Clear photo of your face, well-lit"
            icon="person-circle-outline"
            doc={documents.selfie}
            onPress={() => showImageOptions("selfie")}
            theme={theme}
            styles={styles}
          />
        </Animated.View>

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

        <Animated.View entering={FadeInUp.delay(320)}>
          <TouchableOpacity
            style={[
              styles.submitBtn,
              (!hasAllNewUploads || anyUploading || submitting) && styles.submitBtnDisabled
            ]}
            onPress={handleSubmit}
            disabled={!hasAllNewUploads || anyUploading || submitting}
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
  
  centeredContent: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: "center",
    alignItems: "center",
  },
  statusCard: {
    alignItems: "center",
    paddingHorizontal: spacing.xl,
  },
  statusIconLarge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xl,
  },
  statusTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: theme.textPrimary,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  statusDescription: {
    fontSize: 15,
    color: theme.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  statusMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
  },
  statusMetaText: {
    fontSize: 13,
    color: theme.textSecondary,
  },
  
  docSummaryCard: {
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginTop: spacing.xl,
    width: "100%",
  },
  docSummaryTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.textPrimary,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  docSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  docSummaryItem: {
    alignItems: "center",
    gap: 4,
  },
  docSummaryText: {
    fontSize: 11,
    color: theme.textSecondary,
    fontWeight: "600",
  },
  
  backHomeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.xxl,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: theme.primary,
  },
  backHomeBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.primary,
  },
  
  rejectionCard: {
    backgroundColor: `${theme.error}10`,
    borderRadius: radius.xl,
    padding: spacing.lg,
    flexDirection: "row",
    gap: 12,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: `${theme.error}30`,
  },
  rejectionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: `${theme.error}15`,
    alignItems: "center",
    justifyContent: "center",
  },
  rejectionTitle: { 
    fontSize: 16, 
    fontWeight: "700", 
    color: theme.error, 
    marginBottom: 4 
  },
  rejectionText: { 
    fontSize: 13, 
    color: theme.textSecondary, 
    lineHeight: 18 
  },
  
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
