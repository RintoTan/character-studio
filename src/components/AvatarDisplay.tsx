import { useEffect, useState } from "react";
import { getAvatarAsset } from "../utils/avatarAssets";

type AvatarDisplayProps = {
  assetId?: string;
  emoji?: string;
  className: string;
  label?: string;
  previewImageUrl?: string;
};

export function AvatarDisplay({
  assetId,
  emoji = "🙂",
  className,
  label,
  previewImageUrl,
}: AvatarDisplayProps) {
  const [imageUrl, setImageUrl] = useState("");

  useEffect(() => {
    let isMounted = true;
    let objectUrl = "";

    async function loadAsset() {
      if (!assetId) {
        setImageUrl("");
        return;
      }

      try {
        const asset = await getAvatarAsset(assetId);

        if (!asset || !isMounted) {
          setImageUrl("");
          return;
        }

        objectUrl = URL.createObjectURL(asset.blob);
        setImageUrl(objectUrl);
      } catch {
        setImageUrl("");
      }
    }

    void loadAsset();

    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [assetId]);

  const visibleImageUrl = previewImageUrl || imageUrl;

  return (
    <span
      className={className}
      aria-label={label}
      data-avatar-asset={Boolean(assetId || previewImageUrl)}
      data-avatar-image={Boolean(visibleImageUrl)}
    >
      {visibleImageUrl ? <img alt="" src={visibleImageUrl} /> : emoji}
    </span>
  );
}
