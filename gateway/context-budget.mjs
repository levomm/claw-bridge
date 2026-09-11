const DEFAULT_CHAR_BUDGET = 12000

function clip(value, max = 1200) {
  const text = String(value ?? "").trim()
  if (!text) return ""
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function words(value) {
  return new Set(String(value || "").toLowerCase().match(/[a-z0-9_./-]{3,}/g) || [])
}

function relevance(value, queryWords) {
  if (!queryWords.size) return 0
  const hay = words(typeof value === "string" ? value : JSON.stringify(value))
  let score = 0
  for (const word of queryWords) if (hay.has(word)) score += 1
  return score
}

function compactResult(result) {
  if (!result) return null
  return {
    ok: Boolean(result.ok),
    executor: clip(result.executor, 80),
    summary: clip(result.summary, 900),
    changedFiles: Array.isArray(result.changedFiles) ? result.changedFiles.slice(0, 20).map((item) => clip(item, 180)) : [],
    tests: Array.isArray(result.tests) ? result.tests.slice(-8).map((item) => clip(item, 240)) : [],
    blockers: Array.isArray(result.blockers) ? result.blockers.slice(0, 8).map((item) => clip(item, 240)) : [],
    commit: clip(result.commit, 80),
  }
}

function compactHandoff(item) {
  if (!item) return null
  return {
    id: clip(item.id, 120),
    from: clip(item.from, 40),
    to: clip(item.to, 40),
    goal: clip(item.goal, 700),
    plan: Array.isArray(item.plan) ? item.plan.slice(0, 8).map((x) => clip(x, 300)) : clip(item.plan, 900),
    decisions: Array.isArray(item.decisions) ? item.decisions.slice(0, 8).map((x) => clip(x, 300)) : clip(item.decisions, 900),
    constraints: Array.isArray(item.constraints) ? item.constraints.slice(0, 8).map((x) => clip(x, 260)) : clip(item.constraints, 700),
    relevantFiles: Array.isArray(item.relevantFiles) ? item.relevantFiles.slice(0, 16).map((x) => clip(x, 180)) : [],
    acceptanceCriteria: Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria.slice(0, 8).map((x) => clip(x, 260)) : clip(item.acceptanceCriteria, 700),
    status: clip(item.status, 60),
    result: compactResult(item.result),
  }
}

function compactNote(note) {
  if (!note) return null
  if (typeof note === "string") return clip(note, 700)
  return {
    id: clip(note.id, 100),
    source: clip(note.source, 80),
    text: clip(note.text ?? note.content ?? note.note, 700),
    createdAt: clip(note.createdAt ?? note.ts, 80),
  }
}

function shrinkToBudget(shared, budget) {
  let output = JSON.stringify(shared)
  if (output.length <= budget) return shared

  while (shared.recentMemory.length > 2 && output.length > budget) {
    shared.recentMemory.pop()
    output = JSON.stringify(shared)
  }
  while (shared.recentHandoffs.length > 1 && output.length > budget) {
    shared.recentHandoffs.pop()
    output = JSON.stringify(shared)
  }
  if (output.length > budget && shared.handoff?.result?.summary) {
    shared.handoff.result.summary = clip(shared.handoff.result.summary, 400)
    output = JSON.stringify(shared)
  }
  if (output.length > budget && shared.project) {
    shared.project = {
      name: clip(shared.project.name, 160),
      path: clip(shared.project.path, 240),
      repo: clip(shared.project.repo, 240),
      branch: clip(shared.project.branch, 120),
      goal: clip(shared.project.goal, 500),
    }
  }
  return shared
}

export function buildCompactSharedContext(snapshot, handoff, userInput, charBudget = DEFAULT_CHAR_BUDGET) {
  const queryWords = words(userInput)
  const notes = (Array.isArray(snapshot?.notes) ? snapshot.notes : [])
    .map((item, index) => ({ item, index, score: relevance(item, queryWords) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 4)
    .map(({ item }) => compactNote(item))
    .filter(Boolean)

  const handoffs = (Array.isArray(snapshot?.handoffs) ? snapshot.handoffs : [])
    .filter((item) => !handoff || item.id !== handoff.id)
    .map((item, index) => ({ item, index, score: relevance(item, queryWords) + (item.status === "in_progress" || item.status === "working" ? 3 : 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2)
    .map(({ item }) => compactHandoff(item))
    .filter(Boolean)

  const runtime = snapshot?.runtime ? {
    cwd: clip(snapshot.runtime.cwd, 240),
    repo: clip(snapshot.runtime.repo, 240),
    branch: clip(snapshot.runtime.branch, 120),
    commit: clip(snapshot.runtime.commit, 80),
    platform: clip(snapshot.runtime.platform, 80),
    gatewayName: clip(snapshot.runtime.gatewayName, 120),
    availableExecutors: Array.isArray(snapshot.runtime.availableExecutors) ? snapshot.runtime.availableExecutors.slice(0, 8) : [],
    activeSeekClawJob: snapshot.runtime.activeSeekClawJob || null,
  } : null

  const project = snapshot?.project ? {
    name: clip(snapshot.project.name, 160),
    path: clip(snapshot.project.path, 240),
    repo: clip(snapshot.project.repo, 240),
    branch: clip(snapshot.project.branch, 120),
    goal: clip(snapshot.project.goal, 700),
    constraints: Array.isArray(snapshot.project.constraints) ? snapshot.project.constraints.slice(0, 8).map((x) => clip(x, 260)) : [],
  } : null

  return shrinkToBudget({
    identity: snapshot?.identity ? {
      name: clip(snapshot.identity.name, 120),
      role: clip(snapshot.identity.role, 160),
    } : null,
    runtime,
    project,
    recentMemory: notes,
    recentHandoffs: handoffs,
    handoff: compactHandoff(handoff),
  }, Math.max(4000, Number(charBudget) || DEFAULT_CHAR_BUDGET))
}

export const CONTEXT_CHAR_BUDGET = DEFAULT_CHAR_BUDGET
