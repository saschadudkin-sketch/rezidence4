import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRequests } from '../store/AppStore.jsx';
import { useDebounce } from '../hooks/useDebounce';
import { sortReqs, filterByPeriod } from '../utils.js';
import { isPassRequest, isTechRequest } from '../constants/requestPredicates.js';
import { CreateModal } from '../requests/CreateModal.jsx';
import { ScanQRModal } from '../requests/ScanQRModal.jsx';
import { ChatView } from '../chat/ChatView.jsx';
import { MyTemplates } from '../perms/PermsList.jsx';
import BlacklistView from './BlacklistView.jsx';
import VisitLogView from './VisitLogView.jsx';
import ResidentsView from './ResidentsView.jsx';
import GuardPostMode from './GuardPostMode.jsx';
import { SecurityPassesPane } from './security/SecurityPassesPane';
import { SecurityPermsList } from './security/SecurityPermsList';
import { ConciergePassesTab } from './security/ConciergePassesTab';
import { ConciergeTechTab } from './security/ConciergeTechTab';
import type { AppRequest, RequestType } from '../store/slices/requestsSlice';
import type { AppUser } from '../store/slices/usersSlice';
import type { Template } from '../store/slices/permsSlice';

type ModalState = {
  type: RequestType;
  cat?: string;
  data?: Record<string, unknown>;
} | null;

type ConciergeViewProps = {
  user: AppUser;
  activeTab: string;
  setActiveTab: (tab: string) => void;
};

type SecurityViewProps = {
  user: AppUser;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  highlightReqId?: string | null;
  setHighlightReqId?: (reqId: string | null) => void;
};

function matchesRequestQuery(req: AppRequest, query: string): boolean {
  if (!query) return true;
  return [
    req.createdByName,
    req.createdByApt,
    req.visitorName,
    req.carPlate,
    req.comment,
  ].some((value) => typeof value === 'string' && value.toLowerCase().includes(query));
}

export function ConciergeView({ user, activeTab, setActiveTab }: ConciergeViewProps) {
  const requests = useRequests();
  const [modal, setModal] = useState<ModalState>(null);
  const [query, setQuery] = useState('');
  const [showScan, setShowScan] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const debouncedQuery = useDebounce(query, 250);

  useEffect(() => {
    setQuery('');
  }, [activeTab]);

  const normalizedQuery = useMemo(
    () => debouncedQuery.trim().toLowerCase(),
    [debouncedQuery],
  );

  const matchQuery = useCallback(
    (req: AppRequest) => matchesRequestQuery(req, normalizedQuery),
    [normalizedQuery],
  );

  const allPasses = useMemo(
    () => sortReqs(filterByPeriod(requests.filter(isPassRequest), 'all').filter(matchQuery)) as AppRequest[],
    [requests, matchQuery],
  );
  const allTech = useMemo(
    () => sortReqs(filterByPeriod(requests.filter(isTechRequest), 'all').filter(matchQuery)) as AppRequest[],
    [requests, matchQuery],
  );

  return (
    <>
      {activeTab === 'passes' && (
        <ConciergePassesTab
          user={user}
          query={query}
          setQuery={setQuery}
          showAll={showAll}
          setShowAll={setShowAll}
          setShowScan={setShowScan}
          setModal={setModal}
          allPasses={allPasses}
          debouncedQuery={debouncedQuery}
        />
      )}

      {activeTab === 'tech' && (
        <ConciergeTechTab
          user={user}
          query={query}
          setQuery={setQuery}
          setActiveTab={setActiveTab}
          setModal={setModal}
          allTech={allTech}
          debouncedQuery={debouncedQuery}
        />
      )}

      {activeTab === 'templates' && <MyTemplates user={user} onUse={(template: Template) => setModal({ type: template.type as RequestType, cat: template.category, data: template as unknown as Record<string, unknown> })} />}
      {activeTab === 'residents' && (
        <ResidentsView
          user={user}
          onCreatePass={(resident) => setModal({ type: 'pass', cat: 'guest', data: { apartment: resident.apartment } })}
        />
      )}
      {activeTab === 'visitlog' && <VisitLogView user={user} />}
      {activeTab === 'blacklist' && <BlacklistView user={user} />}
      {activeTab === 'chat' && <ChatView user={user} />}
      {modal && (
        <CreateModal
          user={user}
          type={modal.type}
          initialCat={modal.cat}
          initialData={modal.data}
          onClose={() => setModal(null)}
          onDone={() => {}}
        />
      )}
      {showScan && <ScanQRModal user={user} onClose={() => setShowScan(false)} />}
    </>
  );
}

export function SecurityView({ user, activeTab, setActiveTab, highlightReqId, setHighlightReqId }: SecurityViewProps) {
  return (
    <>
      {activeTab === 'passes' && (
        <SecurityPassesPane
          user={user}
          highlightReqId={highlightReqId}
          setHighlightReqId={setHighlightReqId}
        />
      )}
      {activeTab === 'perms' && <SecurityPermsList />}
      {activeTab === 'visitlog' && <VisitLogView user={user} />}
      {activeTab === 'blacklist' && <BlacklistView user={user} />}
      {activeTab === 'guardpost' && (
        <GuardPostMode
          user={user}
          onViewDetails={(reqId) => {
            setActiveTab('passes');
            setHighlightReqId?.(reqId);
          }}
        />
      )}
      {activeTab === 'residents' && <ResidentsView user={user} />}
      {activeTab === 'chat' && <ChatView user={user} />}
    </>
  );
}
