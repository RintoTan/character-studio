import { useEffect, useState } from "react";
import { getAvatarAsset } from "../utils/avatarAssets";

type AvatarDisplayProps = {
  assetId?: string;
  emoji?: string;
  className: string;
  label?: string;
};

export function AvatarDisplay({
  assetId,
  emoji = "🙂",
  className,
  label,
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

  return (
    <span className={className} aria-label={label} data-avatar-image={Boolean(imageUrl)}>
      {imageUrl ? <img alt="" src={imageUrl} /> : emoji}
    </span>
  );
}
