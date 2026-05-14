import { useState, useMemo, useRef, useEffect } from 'react';
import { useAppStoreSelector } from '../store/AppStore.jsx';
import { useDebounce } from '../hooks/useDebounce';
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
import StateBlock from '../ui/StateBlock';
import { getViewStateCopy } from '../ui/viewStateContract';
import { makeSelectConciergeCollections } from '../store/selectors/requestsSelectors';
import type { RequestType } from '../store/slices/requestsSlice';
import type { AppUser } from '../store/slices/usersSlice';
import type { Template } from '../store/slices/permsSlice';

// UX-contract (scripts/check-ux-contract.js): featureListView должен иметь
// видимый fallback-state, если activeTab не совпадает ни с одним из known
// разделов. Раньше unknown tab отдавал пустой fragment — теперь юзер видит
// понятный error-state и может вернуться на корректный таб.
const CONCIERGE_KNOWN_TABS = new Set([
  'passes', 'tech', 'templates', 'residents', 'visitlog', 'blacklist', 'chat',
]);
const SECURITY_KNOWN_TABS = new Set([
  'passes', 'perms', 'visitlog', 'blacklist', 'guardpost', 'residents', 'chat',
]);

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

export function ConciergeView({ user, activeTab, setActiveTab }: ConciergeViewProps) {
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
  const conciergeCollectionsSelectorRef = useRef(makeSelectConciergeCollections());
  const { allPasses, allTech } = useAppStoreSelector((state) =>
    conciergeCollectionsSelectorRef.current(state, normalizedQuery)
  );

  const isKnownConciergeTab = CONCIERGE_KNOWN_TABS.has(activeTab);

  return (
    <>
      {!isKnownConciergeTab && (
        <StateBlock
          type="error"
          title={getViewStateCopy('default', 'error').title}
          subtitle={getViewStateCopy('default', 'error').subtitle}
        />
      )}
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
  const isKnownSecurityTab = SECURITY_KNOWN_TABS.has(activeTab);

  return (
    <>
      {!isKnownSecurityTab && (
        <StateBlock
          type="error"
          title={getViewStateCopy('default', 'error').title}
          subtitle={getViewStateCopy('default', 'error').subtitle}
        />
      )}
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
