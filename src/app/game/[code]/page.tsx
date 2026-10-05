"use client";

import { useParams } from "next/navigation";
import GameRoom from "@/components/GameRoom";

export default function GamePage() {
  const params = useParams();
  const rawCode = params ? params.code : "";
  const code = decodeURIComponent(String(rawCode ?? ""));

  return <GameRoom code={code} />;
}