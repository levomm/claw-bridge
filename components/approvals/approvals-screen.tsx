"use client"

import * as React from "react"
import { ShieldCheckIcon, ShieldAlertIcon } from "lucide-react"
import { toast } from "sonner"
import { useBridge } from "@/components/providers/bridge-provider"
import { TARGET_LABELS, type ApprovalDecision, type ApprovalRequest, type AuditEntry, type RiskLevel } from "@/lib/gateway"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

const RISK_VARIANT: Record<RiskLevel, "secondary" | "outline" | "destructive"> = {
  low: "secondary",
  medium: "outline",
  high: "destructive",
}

const DECISION_LABEL: Record<ApprovalDecision, string> = {
  deny: "Denied",
  "allow-once": "Allowed once",
  "always-allow": "Always allowed",
}

function timeAgo(iso: string) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

function ApprovalCard({ approval, onDecide }: { approval: ApprovalRequest; onDecide: (d: ApprovalDecision) => Promise<void> }) {
  const [pending, setPending] = React.useState<ApprovalDecision | null>(null)
  async function decide(d: ApprovalDecision) {
    setPending(d)
    try {
      await onDecide(d)
    } finally {
      setPending(null)
    }
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardDescription className="font-mono text-xs">
            {TARGET_LABELS[approval.agent]} · {approval.project}
          </CardDescription>
          <Badge variant={RISK_VARIANT[approval.risk]} className="uppercase">
            {approval.risk} risk
          </Badge>
        </div>
        <CardTitle className="text-sm font-normal text-muted-foreground">{approval.reason}</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {approval.command}
        </pre>
        <p className="mt-2 text-xs text-muted-foreground">Requested {timeAgo(approval.createdAt)}</p>
      </CardContent>
      <CardFooter className="grid grid-cols-3 gap-2">
        <Button variant="outline" disabled={!!pending} onClick={() => void decide("deny")}>
          {pending === "deny" ? <Spinner /> : "Deny"}
        </Button>
        <Button variant="secondary" disabled={!!pending} onClick={() => void decide("allow-once")}>
          {pending === "allow-once" ? <Spinner /> : "Allow once"}
        </Button>
        <Button disabled={!!pending} onClick={() => void decide("always-allow")} className="text-xs">
          {pending === "always-allow" ? <Spinner /> : "Always allow"}
        </Button>
      </CardFooter>
    </Card>
  )
}

export function ApprovalsScreen() {
  const { client, connectionState } = useBridge()
  const [approvals, setApprovals] = React.useState<ApprovalRequest[] | null>(null)
  const [audit, setAudit] = React.useState<AuditEntry[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const [a, l] = await Promise.all([client.listApprovals(), client.listAuditLog()])
      setApprovals(a)
      setAudit(l)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load approvals")
      setApprovals([])
      setAudit([])
    }
  }, [client])

  React.useEffect(() => {
    void load()
    return client.subscribeApprovals((next) => setApprovals(next))
  }, [client, load])

  async function decide(id: string, decision: ApprovalDecision) {
    try {
      await client.resolveApproval(id, decision)
      toast.success(DECISION_LABEL[decision])
      const l = await client.listAuditLog()
      setAudit(l)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resolve approval")
    }
  }

  const pending = (approvals ?? []).filter((a) => a.status === "pending")

  return (
    <Tabs defaultValue="pending" className="gap-4">
      <TabsList className="w-full">
        <TabsTrigger value="pending" className="flex-1">
          Pending{pending.length > 0 && <Badge className="ml-1 h-4 min-w-4 px-1 font-mono text-[10px]">{pending.length}</Badge>}
        </TabsTrigger>
        <TabsTrigger value="audit" className="flex-1">
          Audit history
        </TabsTrigger>
      </TabsList>

      <TabsContent value="pending" className="flex flex-col gap-3">
        {approvals === null ? (
          <>
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </>
        ) : error ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldAlertIcon />
              </EmptyMedia>
              <EmptyTitle>Could not load approvals</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </Empty>
        ) : pending.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldCheckIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing to approve</EmptyTitle>
              <EmptyDescription>
                {connectionState === "online" ? "New requests from agents will show up here." : "Approvals sync when the gateway is back online."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          pending.map((a) => <ApprovalCard key={a.id} approval={a} onDecide={(d) => decide(a.id, d)} />)
        )}
      </TabsContent>

      <TabsContent value="audit" className="flex flex-col gap-2">
        {audit === null ? (
          <Skeleton className="h-64 w-full" />
        ) : audit.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No decisions yet</EmptyTitle>
              <EmptyDescription>Every allow or deny is recorded here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          audit.map((e) => (
            <div key={e.id} className="flex flex-col gap-1 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {TARGET_LABELS[e.agent]} · {e.project}
                </span>
                <Badge variant={e.decision === "deny" ? "destructive" : "secondary"} className="text-[10px]">
                  {DECISION_LABEL[e.decision]}
                </Badge>
              </div>
              <code className="truncate font-mono text-xs">{e.command}</code>
              <span className="text-xs text-muted-foreground">
                {e.risk} risk · {timeAgo(e.decidedAt)}
              </span>
            </div>
          ))
        )}
      </TabsContent>
    </Tabs>
  )
}
