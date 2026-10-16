import { ActivityIndicator, Image, Modal, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import type { ConnectTheme } from '../theme/theme';
import { RADIUS, SPACE } from '../theme/tokens';
import { MotionPressable } from './MotionPressable';
import { t } from '../i18n';

export interface RoomImageViewerProps {
  open: boolean;
  uri: string | null;
  pending: boolean;
  error: string | null;
  theme: ConnectTheme;
  onClose(): void;
}

export function RoomImageViewer({
  open,
  uri,
  pending,
  error,
  theme,
  onClose,
}: RoomImageViewerProps): React.ReactElement {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
      transparent={false}
      visible={open}
    >
      <View style={[styles.root, { backgroundColor: theme.colors.bg }]}>
        <MotionPressable
          accessibilityLabel={t('关闭图片')}
          accessibilityRole="button"
          onPress={onClose}
          style={[
            styles.close,
            { backgroundColor: theme.colors.panel2, borderColor: theme.colors.line2 },
          ]}
        >
          <X color={theme.colors.text} size={24} />
        </MotionPressable>
        {pending ? (
          <ActivityIndicator accessibilityLabel={t('正在加载图片')} color={theme.colors.accent} size="large" />
        ) : uri !== null ? (
          <Image
            accessibilityLabel={t('协作图片')}
            resizeMode="contain"
            source={{ uri }}
            style={styles.image}
          />
        ) : (
          <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
            {t(error ?? '图片加载失败')}
          </Text>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE.x3,
  },
  close: {
    position: 'absolute',
    top: 54,
    right: SPACE.x3,
    zIndex: 1,
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
