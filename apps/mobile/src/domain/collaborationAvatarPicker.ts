import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync } from 'expo-image-picker';

const AVATAR_MAX_CHARS = 800_000;
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/u;

export async function pickCollaborationAvatar(): Promise<string | null> {
  const picked = await launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    allowsMultipleSelection: false,
    selectionLimit: 1,
    quality: 1,
    exif: false,
    base64: false,
  });
  if (picked.canceled || picked.assets.length === 0) return null;

  const result = await manipulateAsync(
    picked.assets[0]!.uri,
    [{ resize: { width: 256, height: 256 } }],
    { format: SaveFormat.JPEG, compress: 0.82, base64: true },
  );
  try {
    const base64 = result.base64;
    const avatar = typeof base64 === 'string'
      ? `data:image/jpeg;base64,${base64}`
      : '';
    if (
      avatar.length < 27
      || avatar.length > AVATAR_MAX_CHARS
      || !BASE64_RE.test(base64 ?? '')
    ) throw new Error('头像处理失败，请换一张图片。');
    return avatar;
  } finally {
    try {
      const file = new File(result.uri);
      if (file.exists) file.delete();
    } catch {
      // Manipulator output is app-owned temporary data; cleanup is best effort.
    }
  }
}
