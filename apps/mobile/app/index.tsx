import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const actions = [
  { title: "Пригласить гостя", detail: "Создать пропуск для визита", icon: "＋" },
  { title: "Мои пропуска", detail: "Посмотреть статус и срок действия", icon: "▤" },
  { title: "Помощь охраны", detail: "Связаться с постом охраны", icon: "↗" },
];

export default function HomeScreen() {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.topline}>
          <View style={styles.brandMark}><Text style={styles.brandLetters}>R</Text></View>
          <View style={styles.brandCopy}>
            <Text style={styles.eyebrow}>ЧАСТНАЯ РЕЗИДЕНЦИЯ</Text>
            <Text style={styles.brand}>Замоскворечье</Text>
          </View>
          <View style={styles.statusDot} />
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>ВАШ ДОМ. ВАШ РИТМ.</Text>
          <Text style={styles.heading}>Добро пожаловать</Text>
          <Text style={styles.subheading}>
            Пропуска для гостей и важные вопросы — в одном месте.
          </Text>
          <View style={styles.heroRule} />
          <Text style={styles.statusLabel}>МОБИЛЬНОЕ ПРИЛОЖЕНИЕ</Text>
          <Text style={styles.statusText}>
            Основа приложения готова. Подключение к аккаунту и реальные пропуска появятся после проверки мобильной авторизации сервера.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Быстрые действия</Text>
        {actions.map((action) => (
          <Pressable
            key={action.title}
            accessibilityRole="button"
            accessibilityLabel={action.title}
            onPress={() => setNotice("Этот раздел подключим к серверу после проверки API и прав доступа.")}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <View style={styles.actionIcon}><Text style={styles.actionIconText}>{action.icon}</Text></View>
            <View style={styles.actionCopy}>
              <Text style={styles.actionTitle}>{action.title}</Text>
              <Text style={styles.actionDetail}>{action.detail}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}

        {notice ? (
          <Pressable style={styles.notice} onPress={() => setNotice(null)} accessibilityRole="button">
            <Text style={styles.noticeText}>{notice}</Text>
            <Text style={styles.noticeDismiss}>Понятно</Text>
          </Pressable>
        ) : null}

        <Text style={styles.footer}>Доступ и безопасность — под контролем.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5F1E8" },
  page: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 36 },
  topline: { flexDirection: "row", alignItems: "center", marginBottom: 28 },
  brandMark: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#242B27", alignItems: "center", justifyContent: "center" },
  brandLetters: { color: "#D7BD83", fontSize: 22, fontWeight: "600" },
  brandCopy: { marginLeft: 12, flex: 1 },
  eyebrow: { color: "#857B68", fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },
  brand: { color: "#242B27", fontSize: 17, fontWeight: "600", marginTop: 3 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#B69A61" },
  hero: { backgroundColor: "#242B27", borderRadius: 22, padding: 23, marginBottom: 30 },
  heading: { color: "#FFFDF8", fontSize: 29, fontWeight: "600", letterSpacing: -0.8, marginTop: 14 },
  subheading: { color: "#D5D5CC", fontSize: 15, lineHeight: 23, marginTop: 10 },
  heroRule: { height: 1, backgroundColor: "#51564D", marginVertical: 22 },
  statusLabel: { color: "#D7BD83", fontSize: 10, fontWeight: "700", letterSpacing: 1.2 },
  statusText: { color: "#E4E4DC", fontSize: 13, lineHeight: 20, marginTop: 8 },
  sectionTitle: { color: "#242B27", fontSize: 20, fontWeight: "600", marginBottom: 14 },
  action: { minHeight: 78, backgroundColor: "#FFFEFA", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14, flexDirection: "row", alignItems: "center", marginBottom: 10, borderWidth: 1, borderColor: "#E8E2D5" },
  pressed: { opacity: 0.72 },
  actionIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#F0E9D9", alignItems: "center", justifyContent: "center" },
  actionIconText: { color: "#73613B", fontSize: 24 },
  actionCopy: { flex: 1, marginLeft: 12 },
  actionTitle: { color: "#292E29", fontSize: 15, fontWeight: "600" },
  actionDetail: { color: "#77776F", fontSize: 12, marginTop: 4 },
  chevron: { color: "#9C927E", fontSize: 27, paddingLeft: 8 },
  notice: { backgroundColor: "#EAE2D1", padding: 16, borderRadius: 14, marginTop: 8 },
  noticeText: { color: "#3D4038", fontSize: 13, lineHeight: 20 },
  noticeDismiss: { color: "#6B5936", fontSize: 12, fontWeight: "700", marginTop: 10 },
  footer: { color: "#8B8578", textAlign: "center", fontSize: 11, marginTop: 24 },
});
