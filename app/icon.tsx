import { ImageResponse } from "next/og";
import { DessinIcone } from "@/components/IconeApp";

/**
 * Les icônes de l'application installée — /icon/192 et /icon/512 (manifeste),
 * générées au build. Publiques : le middleware les laisse passer, le
 * navigateur les charge sans cookie.
 */
export function generateImageMetadata() {
  return [192, 512].map((t) => ({
    id: String(t),
    size: { width: t, height: t },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: string | Promise<string> }) {
  const taille = Number(await id) === 512 ? 512 : 192;
  return new ImageResponse(<DessinIcone taille={taille} />, { width: taille, height: taille });
}
