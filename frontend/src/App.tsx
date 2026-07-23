import {
  applyNodeChanges,
  Background,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

type SearchItem = {
  id: number;
  spelling: string;
  language: string;
  aliases: string[];
  meaning_preview: string;
};

type EntryRef = {
  id: number;
  spelling: string;
  language: string;
};

type UnresolvedLink = {
  label: string;
};

type EntryDetail = {
  id: number;
  spelling: string;
  language: string;
  meaning: string;
  aliases_raw: string;
  aliases: string[];
  upstream_raw: string;
  upstream_resolved: EntryRef[];
  upstream_unresolved: UnresolvedLink[];
  downstream: EntryRef[];
  created_at: string;
  updated_at: string;
};

type EntryPayload = {
  spelling: string;
  language: string;
  meaning: string;
  aliases_raw: string;
  upstream_raw: string;
};

type CsvImportResponse = {
  ok: boolean;
  imported_count: number;
};

type ViewMode = 'card' | 'column';

type IconButtonProps = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
};

type CardNodeData = {
  entry: EntryDetail;
  handleLayout: 'horizontal' | 'vertical';
  onHide: (id: number) => void;
  onEdit: (entry: EntryDetail) => void;
  onDelete: (entry: EntryDetail) => void;
  onOpen: (id: number, sourceId?: number, relation?: 'upstream' | 'downstream', relationIndex?: number, relationCount?: number) => void;
  onMeasure: (id: number, height: number) => void;
};

type AppNode = Node<CardNodeData, 'entryCard'>;

const CARD_WIDTH = 308;
const CARD_MIN_HEIGHT = 220;
const HORIZONTAL_GAP = 170;
const VERTICAL_GAP = 36;
const BOARD_PADDING_X = 72;
const BOARD_PADDING_Y = 56;
const LINK_STACK_GAP = 88;

function buildLinkedCardPosition(
  source: AppNode,
  relation: 'upstream' | 'downstream',
  relationIndex = 0,
  relationCount = 1,
) {
  const sourceWidth = source.measured?.width ?? CARD_WIDTH;
  const sourceHeight = source.measured?.height ?? CARD_MIN_HEIGHT;
  const centeredIndex = relationIndex - (relationCount - 1) / 2;
  const horizontalLayout = source.data.handleLayout === 'horizontal';

  if (horizontalLayout) {
    const direction = relation === 'upstream' ? -1 : 1;
    const yOffset = centeredIndex * LINK_STACK_GAP;

    return {
      x: source.position.x + direction * (sourceWidth + HORIZONTAL_GAP),
      y: source.position.y + sourceHeight / 2 - CARD_MIN_HEIGHT / 2 + yOffset,
    };
  }

  const direction = relation === 'upstream' ? -1 : 1;
  const xOffset = centeredIndex * LINK_STACK_GAP;

  return {
    x: source.position.x + sourceWidth / 2 - CARD_WIDTH / 2 + xOffset,
    y: source.position.y + direction * (sourceHeight + VERTICAL_GAP),
  };
}

const EMPTY_FORM: EntryPayload = {
  spelling: '',
  language: '',
  meaning: '',
  aliases_raw: '',
  upstream_raw: '',
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as { detail?: string; message?: string };
      throw new Error(payload.detail || payload.message || 'Request failed');
    }

    const message = await response.text();
    throw new Error(message || 'Request failed');
  }

  return response.json() as Promise<T>;
}

async function apiBlob(path: string, init?: RequestInit): Promise<Blob> {
  const response = await fetch(path, init);

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as { detail?: string; message?: string };
      throw new Error(payload.detail || payload.message || 'Request failed');
    }

    const message = await response.text();
    throw new Error(message || 'Request failed');
  }

  return response.blob();
}

function IconButton({ label, onClick, danger = false, children }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button${danger ? ' icon-button-danger' : ''}`}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function buildLevels(entries: EntryDetail[], orderedIds: number[]) {
  const visibleIds = new Set(entries.map((entry) => entry.id));
  const levelById = new Map<number, number>(entries.map((entry) => [entry.id, 0]));

  for (let pass = 0; pass < entries.length; pass += 1) {
    let changed = false;
    for (const entry of entries) {
      let nextLevel = levelById.get(entry.id) ?? 0;
      for (const upstream of entry.upstream_resolved) {
        if (!visibleIds.has(upstream.id)) {
          continue;
        }
        nextLevel = Math.max(nextLevel, (levelById.get(upstream.id) ?? 0) + 1);
      }
      if (nextLevel !== levelById.get(entry.id)) {
        levelById.set(entry.id, nextLevel);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  const minimum = Math.min(...Array.from(levelById.values()));
  if (minimum !== 0 && Number.isFinite(minimum)) {
    for (const [id, level] of levelById.entries()) {
      levelById.set(id, level - minimum);
    }
  }

  const orderIndex = new Map<number, number>(orderedIds.map((id, index) => [id, index]));
  const columns = new Map<number, EntryDetail[]>();
  for (const entry of entries) {
    const level = levelById.get(entry.id) ?? 0;
    const column = columns.get(level) ?? [];
    column.push(entry);
    columns.set(level, column);
  }

  const sortedLevels = Array.from(columns.keys()).sort((a, b) => a - b);
  return sortedLevels.map((level) => ({
    level,
    entries: (columns.get(level) ?? []).sort(
      (left, right) => (orderIndex.get(left.id) ?? 0) - (orderIndex.get(right.id) ?? 0),
    ),
  }));
}

function buildFloatingPositions(
  entries: EntryDetail[],
  orderedIds: number[],
  measuredHeights: Record<number, number>,
) {
  const positions = new Map<number, { x: number; y: number }>();
  const columns = buildLevels(entries, orderedIds);

  for (const column of columns) {
    const baseX = BOARD_PADDING_X + column.level * (CARD_WIDTH + HORIZONTAL_GAP);
    let currentY = BOARD_PADDING_Y + (column.level % 2) * 28;

    column.entries.forEach((entry, index) => {
      const offsetX = (index % 2) * 22;
      const offsetY = (index % 3) * 10;

      positions.set(entry.id, {
        x: baseX + offsetX,
        y: currentY + offsetY,
      });

      const height = measuredHeights[entry.id] ?? CARD_MIN_HEIGHT;
      currentY += height + VERTICAL_GAP + (index % 2) * 8;
    });
  }

  return positions;
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

function avoidOccupiedPositions(
  entries: EntryDetail[],
  basePositions: Map<number, { x: number; y: number }>,
  measuredHeights: Record<number, number>,
  existingNodes: Map<number, AppNode>,
) {
  const occupied = entries
    .map((entry) => {
      const existing = existingNodes.get(entry.id);
      if (!existing) {
        return null;
      }

      return {
        id: entry.id,
        x: existing.position.x,
        y: existing.position.y,
        width: existing.measured?.width ?? CARD_WIDTH,
        height: measuredHeights[entry.id] ?? existing.measured?.height ?? CARD_MIN_HEIGHT,
      };
    })
    .filter((item): item is { id: number; x: number; y: number; width: number; height: number } => Boolean(item));

  for (const entry of entries) {
    if (existingNodes.has(entry.id)) {
      continue;
    }

    const base = basePositions.get(entry.id) ?? { x: BOARD_PADDING_X, y: BOARD_PADDING_Y };
    const width = CARD_WIDTH;
    const height = measuredHeights[entry.id] ?? CARD_MIN_HEIGHT;
    let nextX = base.x;
    let nextY = base.y;
    let attempts = 0;

    while (
      occupied.some((other) =>
        rectanglesOverlap(
          { x: nextX, y: nextY, width, height },
          {
            x: other.x,
            y: other.y,
            width: other.width,
            height: other.height,
          },
        ),
      )
    ) {
      nextY += height + VERTICAL_GAP;
      attempts += 1;

      if (attempts % 6 === 0) {
        nextX += 28;
        nextY = base.y + 28;
      }
    }

    basePositions.set(entry.id, { x: nextX, y: nextY });
    occupied.push({ id: entry.id, x: nextX, y: nextY, width, height });
  }

  return basePositions;
}

function buildAvoidingCurvePath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
}: Pick<EdgeProps, 'sourceX' | 'sourceY' | 'targetX' | 'targetY' | 'sourcePosition'>) {
  const horizontal = sourcePosition === Position.Left || sourcePosition === Position.Right;

  if (horizontal) {
    const deltaX = Math.abs(targetX - sourceX);
    const deltaY = targetY - sourceY;
    const escapeX = Math.max(104, Math.min(196, deltaX * 0.42));
    const swayY = Math.max(-88, Math.min(88, deltaY * 0.18));
    const controlSourceX = sourceX + escapeX;
    const controlTargetX = targetX - escapeX;

    return `M ${sourceX} ${sourceY} C ${controlSourceX} ${sourceY + swayY}, ${controlTargetX} ${targetY - swayY}, ${targetX} ${targetY}`;
  }

  const deltaY = Math.abs(targetY - sourceY);
  const deltaX = targetX - sourceX;
  const escapeY = Math.max(104, Math.min(196, deltaY * 0.42));
  const swayX = Math.max(-88, Math.min(88, deltaX * 0.18));
  const controlSourceY = sourceY + escapeY;
  const controlTargetY = targetY - escapeY;

  return `M ${sourceX} ${sourceY} C ${sourceX + swayX} ${controlSourceY}, ${targetX - swayX} ${controlTargetY}, ${targetX} ${targetY}`;
}

function AvoidingCurveEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, markerEnd, style }: EdgeProps) {
  const path = buildAvoidingCurvePath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
  });

  return <BaseEdge path={path} markerEnd={markerEnd} style={style} />;
}

function CardNode({ data }: NodeProps<AppNode>) {
  const cardRef = useRef<HTMLElement | null>(null);
  const targetPosition = data.handleLayout === 'horizontal' ? Position.Left : Position.Top;
  const sourcePosition = data.handleLayout === 'horizontal' ? Position.Right : Position.Bottom;

  useLayoutEffect(() => {
    const cardElement = cardRef.current;
    if (!cardElement) {
      return;
    }

    const report = () => {
      data.onMeasure(data.entry.id, Math.ceil(cardElement.getBoundingClientRect().height));
    };

    report();

    const resizeObserver = new ResizeObserver(report);
    resizeObserver.observe(cardElement);

    return () => resizeObserver.disconnect();
  }, [data]);

  return (
    <article ref={cardRef} className="card flow-card" data-testid={`entry-card-${data.entry.id}`}>
      <Handle type="target" position={targetPosition} className="flow-handle" />
      <Handle type="source" position={sourcePosition} className="flow-handle" />

      <div className="card-header">
        <div className="card-title-wrap">
          <h2>{data.entry.spelling}</h2>
        </div>
        <div className="card-actions nodrag nopan">
          <IconButton label="隐藏卡片" onClick={() => data.onHide(data.entry.id)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              <path d="M6 6 10 10M10 6 6 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </IconButton>
          <IconButton label="修改卡片" onClick={() => data.onEdit(data.entry)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 11.8 11.9 3l1.1 1.1L4.1 13H3z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M10.8 4.1 12 2.9a1.2 1.2 0 0 1 1.7 0l.4.4a1.2 1.2 0 0 1 0 1.7l-1.2 1.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </IconButton>
          <IconButton label="删除卡片" onClick={() => data.onDelete(data.entry)} danger>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.5 4.5h9M6.3 2.8h3.4M5.2 4.5v8.2m2.8-8.2v8.2m2.8-8.2v8.2M4.3 4.5l.6 9h6.2l.6-9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconButton>
        </div>
      </div>

      <p className="meaning">
        {data.entry.meaning || '暂无描述'}
        {data.entry.language ? <span className="meaning-language"> [{data.entry.language}]</span> : null}
      </p>

      <section className="relation-section">
        <div className="relation-label">上游</div>
        <div className="link-row nodrag nopan">
          {data.entry.upstream_resolved.map((link, index) => (
            <button
              key={`${data.entry.id}-up-${link.id}`}
              type="button"
              className="link-pill"
              data-testid={`upstream-link-${data.entry.id}-${link.id}`}
              onClick={(event) => {
                event.stopPropagation();
                data.onOpen(link.id, data.entry.id, 'upstream', index, data.entry.upstream_resolved.length);
              }}
            >
              {link.spelling}
            </button>
          ))}
          {data.entry.upstream_unresolved.map((link) => (
            <span
              key={`${data.entry.id}-missing-${link.label}`}
              className="link-pill unresolved-link"
              data-testid={`unresolved-upstream-${data.entry.id}-${link.label}`}
            >
              {link.label}
            </span>
          ))}
          {data.entry.upstream_resolved.length === 0 && data.entry.upstream_unresolved.length === 0 ? <span className="muted">无上游关联</span> : null}
        </div>
      </section>

      <section className="relation-section relation-section-secondary">
        <div className="relation-label">下游</div>
        <div className="link-row nodrag nopan">
          {data.entry.downstream.map((link, index) => (
            <button
              key={`${data.entry.id}-down-${link.id}`}
              type="button"
              className="link-pill"
              data-testid={`downstream-link-${data.entry.id}-${link.id}`}
              onClick={(event) => {
                event.stopPropagation();
                data.onOpen(link.id, data.entry.id, 'downstream', index, data.entry.downstream.length);
              }}
            >
              {link.spelling}
            </button>
          ))}
          {data.entry.downstream.length === 0 ? <span className="muted">无下游关联</span> : null}
        </div>
      </section>
    </article>
  );
}

const nodeTypes = {
  entryCard: CardNode,
};

const edgeTypes = {
  avoidingCurve: AvoidingCurveEdge,
};

function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[]>([]);
  const [cardIds, setCardIds] = useState<number[]>([]);
  const [cardsById, setCardsById] = useState<Record<number, EntryDetail>>({});
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailEntryId, setDetailEntryId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formState, setFormState] = useState<EntryPayload>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EntryDetail | null>(null);
  const [nodeHeights, setNodeHeights] = useState<Record<number, number>>({});
  const [nodes, setNodes] = useState<AppNode[]>([]);
  const [handleLayout, setHandleLayout] = useState<'horizontal' | 'vertical'>('horizontal');
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const cardIdsRef = useRef<number[]>([]);
  const nodesRef = useRef<AppNode[]>([]);
  const nextZIndexRef = useRef(1);
  const pendingZIndexesRef = useRef<Record<number, number>>({});
  const pendingPositionsRef = useRef<Record<number, { x: number; y: number }>>({});

  useEffect(() => {
    cardIdsRef.current = cardIds;
  }, [cardIds]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }

    const handle = window.setTimeout(async () => {
      try {
        const data = await api<{ items: SearchItem[] }>(`/api/entries/search?q=${encodeURIComponent(trimmed)}`);
        setResults(data.items);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Search failed');
      }
    }, 250);

    return () => window.clearTimeout(handle);
  }, [query]);

  const cards = useMemo(
    () => cardIds.map((id) => cardsById[id]).filter((card): card is EntryDetail => Boolean(card)),
    [cardIds, cardsById],
  );

  const detailEntry = detailEntryId === null ? null : cardsById[detailEntryId] ?? null;

  const edges = useMemo(() => {
    const visibleIds = new Set(cards.map((entry) => entry.id));
    const nextEdges: Edge[] = [];

    for (const entry of cards) {
      for (const downstream of entry.downstream) {
        if (!visibleIds.has(downstream.id)) {
          continue;
        }

        nextEdges.push({
          id: `${entry.id}-${downstream.id}`,
          source: String(entry.id),
          target: String(downstream.id),
          animated: false,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
          },
          style: {
            stroke: 'rgba(129, 111, 92, 0.82)',
            strokeWidth: 2.2,
          },
          type: 'avoidingCurve',
        });
      }
    }

    return nextEdges;
  }, [cards]);

  const canSubmit = formState.spelling.trim().length > 0 && !submitting;

  useEffect(() => {
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [Number(node.id), node]));
      const basePositions = buildFloatingPositions(cards, cardIds, nodeHeights);

      for (const entry of cards) {
        if (currentById.has(entry.id)) {
          continue;
        }

        const pendingPosition = pendingPositionsRef.current[entry.id];
        if (pendingPosition) {
          basePositions.set(entry.id, pendingPosition);
        }
      }

      const nextPositions = avoidOccupiedPositions(cards, basePositions, nodeHeights, currentById);
      const nextNodes = cards.map((entry) => {
        const existing = currentById.get(entry.id);
        return {
          id: String(entry.id),
          type: 'entryCard',
          position: existing?.position ?? nextPositions.get(entry.id) ?? { x: BOARD_PADDING_X, y: BOARD_PADDING_Y },
          zIndex: existing?.zIndex ?? pendingZIndexesRef.current[entry.id] ?? 0,
          draggable: true,
          sourcePosition: handleLayout === 'horizontal' ? Position.Right : Position.Bottom,
          targetPosition: handleLayout === 'horizontal' ? Position.Left : Position.Top,
          data: {
            entry,
            handleLayout,
            onHide: hideCard,
            onEdit: openEditModal,
            onDelete: setDeleteTarget,
            onOpen: handleSelectCard,
            onMeasure: handleMeasure,
          },
        } satisfies AppNode;
      });

      return nextNodes;
    });
  }, [cards, cardIds, handleLayout, nodeHeights]);

  function bringNodeToFront(id: number) {
    const nextZIndex = nextZIndexRef.current;
    nextZIndexRef.current += 1;
    pendingZIndexesRef.current[id] = nextZIndex;
    setNodes((current) => {
      let changed = false;
      const nextNodes = current.map((node) => {
        if (Number(node.id) !== id || node.zIndex === nextZIndex) {
          return node;
        }

        changed = true;
        return { ...node, zIndex: nextZIndex };
      });

      return changed ? nextNodes : current;
    });
  }

  async function loadCard(
    id: number,
    sourceId?: number,
    relation?: 'upstream' | 'downstream',
    relationIndex?: number,
    relationCount?: number,
  ) {
    const alreadyVisible = cardIdsRef.current.includes(id);
    if (!alreadyVisible && sourceId !== undefined && relation) {
      const sourceNode = nodesRef.current.find((node) => Number(node.id) === sourceId);
      if (sourceNode) {
        pendingPositionsRef.current[id] = buildLinkedCardPosition(sourceNode, relation, relationIndex, relationCount);
      }
    }

    const entry = await api<EntryDetail>(`/api/entries/${id}`);
    setCardsById((current) => ({ ...current, [id]: entry }));
    setCardIds((current) => (current.includes(id) ? current : [...current, id]));
    bringNodeToFront(id);
  }

  async function refreshCards(preferredIds?: number[]) {
    const ids = preferredIds ?? cardIdsRef.current;
    if (ids.length === 0) {
      return;
    }

    const loaded = await Promise.all(ids.map((id) => api<EntryDetail>(`/api/entries/${id}`)));
    setCardsById((current) => {
      const next = { ...current };
      for (const card of loaded) {
        next[card.id] = card;
      }
      return next;
    });
  }

  function handleSelectCard(
    id: number,
    sourceId?: number,
    relation?: 'upstream' | 'downstream',
    relationIndex?: number,
    relationCount?: number,
  ) {
    loadCard(id, sourceId, relation, relationIndex, relationCount).catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : 'Failed to add card');
    });
    setQuery('');
    setResults([]);
  }

  function handleMeasure(id: number, height: number) {
    setNodeHeights((current) => {
      if (current[id] === height) {
        return current;
      }
      return { ...current, [id]: height };
    });
  }

  function openCreateModal() {
    setEditingId(null);
    setFormState(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function toggleHandleLayout() {
    setHandleLayout((current) => (current === 'horizontal' ? 'vertical' : 'horizontal'));
  }

  function toggleViewMode() {
    setViewMode((current) => (current === 'card' ? 'column' : 'card'));
  }

  function resetBoardState() {
    setCardIds([]);
    setCardsById({});
    setNodes([]);
    setNodeHeights({});
    setDeleteTarget(null);
    setResults([]);
    setQuery('');
    setModalOpen(false);
    setDetailEntryId(null);
    setEditingId(null);
    setFormState(EMPTY_FORM);
    setFormError(null);
    nextZIndexRef.current = 1;
    pendingZIndexesRef.current = {};
    pendingPositionsRef.current = {};
  }

  function hideCard(id: number) {
    setCardIds((current) => current.filter((cardId) => cardId !== id));
    setNodes((current) => current.filter((node) => Number(node.id) !== id));
    setDetailEntryId((current) => (current === id ? null : current));
    delete pendingZIndexesRef.current[id];
    delete pendingPositionsRef.current[id];
  }

  function openEditModal(entry: EntryDetail) {
    setEditingId(entry.id);
    setFormState({
      spelling: entry.spelling,
      language: entry.language,
      meaning: entry.meaning,
      aliases_raw: entry.aliases_raw,
      upstream_raw: entry.upstream_raw,
    });
    setFormError(null);
    setModalOpen(true);
  }

  function handleNodesChange(changes: NodeChange<AppNode>[]) {
    setNodes((current) => applyNodeChanges(changes, current));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setError(null);
    const creating = editingId === null;

    try {
      const path = editingId === null ? '/api/entries' : `/api/entries/${editingId}`;
      const method = editingId === null ? 'POST' : 'PUT';
      const saved = await api<EntryDetail>(path, {
        method,
        body: JSON.stringify(formState),
      });

      setCardsById((current) => ({ ...current, [saved.id]: saved }));
      setCardIds((current) => (current.includes(saved.id) ? current : [...current, saved.id]));
      if (creating) {
        bringNodeToFront(saved.id);
      }
      setModalOpen(false);
      const idsToRefresh = editingId === null ? [...cardIdsRef.current, saved.id] : cardIdsRef.current;
      await refreshCards(idsToRefresh);
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'Failed to save entry');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }

    try {
      await api<{ ok: boolean }>(`/api/entries/${deleteTarget.id}`, { method: 'DELETE' });
      setCardsById((current) => {
        const next = { ...current };
        delete next[deleteTarget.id];
        return next;
      });
      delete pendingZIndexesRef.current[deleteTarget.id];
      delete pendingPositionsRef.current[deleteTarget.id];
      const remainingIds = cardIdsRef.current.filter((id) => id !== deleteTarget.id);
      setCardIds(remainingIds);
      setDeleteTarget(null);
      await refreshCards(remainingIds);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to delete entry');
    }
  }

  async function handleExportCsv() {
    setCsvBusy(true);
    setError(null);
    setNotice(null);

    try {
      const blob = await apiBlob('/api/entries/export.csv');
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `etymae-entries-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice('CSV 已导出。');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to export CSV');
    } finally {
      setCsvBusy(false);
    }
  }

  function openImportPicker() {
    if (csvBusy) {
      return;
    }
    importInputRef.current?.click();
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    const confirmed = window.confirm('导入会用 CSV 内容覆盖当前数据库，是否继续？');
    if (!confirmed) {
      return;
    }

    setCsvBusy(true);
    setError(null);
    setNotice(null);

    try {
      const csvText = await file.text();
      const result = await api<CsvImportResponse>('/api/entries/import.csv', {
        method: 'POST',
        body: JSON.stringify({ csv_text: csvText }),
      });

      resetBoardState();
      setNotice(`CSV 已导入，当前数据库共覆盖为 ${result.imported_count} 条词条。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to import CSV');
    } finally {
      setCsvBusy(false);
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="search-panel">
          <input
            aria-label="Search entries"
            className="search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索拼写、别名、语言或含义"
          />
          {results.length > 0 ? (
            <div className="search-results">
              {results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="search-result"
                  data-testid={`search-result-${item.id}`}
                  onClick={() => handleSelectCard(item.id)}
                >
                  <span>{item.spelling}</span>
                  <small>{item.language || '未标注语言'}</small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="topbar-actions">
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="visually-hidden"
            onChange={handleImportFile}
          />
          <button type="button" className="text-button" onClick={() => setSettingsOpen(true)}>
            设置
          </button>
          <button type="button" className="text-button" onClick={toggleViewMode}>
            {viewMode === 'card' ? '栏目模式' : '卡片模式'}
          </button>
          <button type="button" className="primary-button" onClick={openCreateModal}>
            新增卡片
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? (
        <div className="success-banner" role="status">
          <span>{notice}</span>
          <button type="button" className="banner-dismiss" aria-label="关闭提示" onClick={() => setNotice(null)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4 4 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ) : null}

      {cards.length === 0 ? (
        <section className="empty-state">
          <h1>词源卡片板</h1>
          <p>从顶部搜索栏加入词条，卡片会以漂浮节点的形式出现在画布中，并保持上下游箭头连接。</p>
        </section>
      ) : viewMode === 'card' ? (
        <section className="board-wrap">
          <div className="board-canvas">
            <ReactFlow
              fitView
              minZoom={0.35}
              maxZoom={1.6}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={handleNodesChange}
              onNodeClick={(_, node) => bringNodeToFront(Number(node.id))}
              onNodeDragStart={(_, node) => bringNodeToFront(Number(node.id))}
              panOnDrag={[1, 2]}
              proOptions={{ hideAttribution: true }}
              nodesConnectable={false}
              elementsSelectable={false}
              zoomOnDoubleClick={false}
              className="floating-flow"
            >
              <Background gap={26} size={1.2} color="rgba(123, 97, 72, 0.14)" />
              <Controls showInteractive={false} position="bottom-right" />
            </ReactFlow>
          </div>
        </section>
      ) : (
        <section className="board-wrap">
          <div className="board-columns" data-testid="column-view">
            {cards.map((entry) => (
              <article key={entry.id} className="column-item" data-testid={`column-item-${entry.id}`}>
                <div className="column-item-main">
                  <h2>{entry.spelling}</h2>
                  {entry.language ? <span className="column-item-language">{entry.language}</span> : null}
                </div>
                <div className="card-actions">
                  <IconButton label="查看详情" onClick={() => setDetailEntryId(entry.id)}>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                      <path d="M8 7.2v3.1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      <circle cx="8" cy="4.8" r="0.8" fill="currentColor" />
                    </svg>
                  </IconButton>
                  <IconButton label="隐藏卡片" onClick={() => hideCard(entry.id)}>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                      <path d="M6 6 10 10M10 6 6 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </IconButton>
                  <IconButton label="修改卡片" onClick={() => openEditModal(entry)}>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3 11.8 11.9 3l1.1 1.1L4.1 13H3z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                      <path d="M10.8 4.1 12 2.9a1.2 1.2 0 0 1 1.7 0l.4.4a1.2 1.2 0 0 1 0 1.7l-1.2 1.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  </IconButton>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {detailEntry ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card detail-card">
            <div className="modal-header">
              <div className="detail-title-block">
                <h2>{detailEntry.spelling}</h2>
                {detailEntry.language ? <span className="column-item-language">{detailEntry.language}</span> : null}
              </div>
              <button type="button" className="text-button" onClick={() => setDetailEntryId(null)}>
                关闭
              </button>
            </div>

            <div className="detail-content">
              <section className="detail-section">
                <div className="relation-label">释义</div>
                <p className="meaning">{detailEntry.meaning || '暂无描述'}</p>
              </section>

              <section className="detail-section">
                <div className="relation-label">上游</div>
                <div className="link-row">
                  {detailEntry.upstream_resolved.map((link, index) => (
                    <button
                      key={`${detailEntry.id}-detail-up-${link.id}`}
                      type="button"
                      className="link-pill"
                      onClick={() => {
                        void loadCard(link.id, detailEntry.id, 'upstream', index, detailEntry.upstream_resolved.length).catch((requestError) => {
                          setError(requestError instanceof Error ? requestError.message : 'Failed to add card');
                        });
                      }}
                    >
                      {link.spelling}
                    </button>
                  ))}
                  {detailEntry.upstream_unresolved.map((link) => (
                    <span key={`${detailEntry.id}-detail-missing-${link.label}`} className="link-pill unresolved-link">
                      {link.label}
                    </span>
                  ))}
                  {detailEntry.upstream_resolved.length === 0 && detailEntry.upstream_unresolved.length === 0 ? <span className="muted">无上游关联</span> : null}
                </div>
              </section>

              <section className="detail-section">
                <div className="relation-label">下游</div>
                <div className="link-row">
                  {detailEntry.downstream.map((link, index) => (
                    <button
                      key={`${detailEntry.id}-detail-down-${link.id}`}
                      type="button"
                      className="link-pill"
                      onClick={() => {
                        void loadCard(link.id, detailEntry.id, 'downstream', index, detailEntry.downstream.length).catch((requestError) => {
                          setError(requestError instanceof Error ? requestError.message : 'Failed to add card');
                        });
                      }}
                    >
                      {link.spelling}
                    </button>
                  ))}
                  {detailEntry.downstream.length === 0 ? <span className="muted">无下游关联</span> : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {modalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card">
            <div className="modal-header">
              <h2>{editingId === null ? '新增卡片' : '修改卡片'}</h2>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setFormError(null);
                  setModalOpen(false);
                }}
              >
                关闭
              </button>
            </div>

            <form className="entry-form" onSubmit={handleSubmit}>
              {formError ? <div className="error-banner">{formError}</div> : null}
              <label>
                拼写
                <input
                  required
                  value={formState.spelling}
                  onChange={(event) => {
                    setFormError(null);
                    setFormState((current) => ({ ...current, spelling: event.target.value }));
                  }}
                />
              </label>

              <label>
                语言归属
                <input
                  value={formState.language}
                  onChange={(event) => {
                    setFormError(null);
                    setFormState((current) => ({ ...current, language: event.target.value }));
                  }}
                />
              </label>

              <label>
                含义描述
                <textarea
                  rows={4}
                  value={formState.meaning}
                  onChange={(event) => {
                    setFormError(null);
                    setFormState((current) => ({ ...current, meaning: event.target.value }));
                  }}
                />
              </label>

              <label>
                别名
                <input
                  value={formState.aliases_raw}
                  onChange={(event) => {
                    setFormError(null);
                    setFormState((current) => ({ ...current, aliases_raw: event.target.value }));
                  }}
                  placeholder="逗号分隔"
                />
              </label>

              <label>
                上游关联
                <textarea
                  rows={3}
                  value={formState.upstream_raw}
                  onChange={(event) => {
                    setFormError(null);
                    setFormState((current) => ({ ...current, upstream_raw: event.target.value }));
                  }}
                  placeholder="按逗号分隔，支持 spelling 或 spelling [语言] 格式"
                />
              </label>

              <div className="form-actions">
                <button type="submit" className="primary-button" disabled={!canSubmit}>
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card settings-card">
            <div className="modal-header">
              <h2>设置</h2>
              <button type="button" className="text-button" onClick={() => setSettingsOpen(false)}>
                关闭
              </button>
            </div>

            <div className="settings-actions">
              <button type="button" className="text-button" onClick={handleExportCsv} disabled={csvBusy}>
                导出 CSV
              </button>
              <button type="button" className="text-button" onClick={openImportPicker} disabled={csvBusy}>
                导入覆盖
              </button>
              <button type="button" className="text-button" onClick={toggleHandleLayout}>
                {handleLayout === 'horizontal' ? '连接点: 左右' : '连接点: 上下'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-card">
            <h2>确认删除</h2>
            <p>删除后，其他卡片对它的关联会保留为红色未解析链接。</p>
            <div className="form-actions">
              <button type="button" className="text-button" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button type="button" className="danger-button" onClick={confirmDelete}>
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
