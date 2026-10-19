import { ImageResponse } from "next/og";
import { DessinIcone } from "@/components/IconeApp";

/** L'icône de l'écran d'accueil de l'iPhone (180 × 180, iOS arrondit lui-même). */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<DessinIcone taille={180} />, size);
}
