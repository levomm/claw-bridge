import type { Metadata } from "next"
import { PairScreen } from "@/components/pair/pair-screen"

export const metadata: Metadata = { title: "Pair" }

export default function PairPage() {
  return <PairScreen />
}
