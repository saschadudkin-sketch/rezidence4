import { memo } from 'react';
import { MyTemplates } from '../../perms/PermsList';

const TemplatesTab = memo(function TemplatesTab({ user, setModal, setActiveTab }) {
  return (
    <>
      <button className="btn-outline u-mb-16" onClick={() => setActiveTab('passes')}>
        ← Назад к пропускам
      </button>
      <MyTemplates user={user} onUse={t => {
        setModal({ type: t.type, cat: t.category, data: {
          visitorName: t.visitorName, visitorPhone: t.visitorPhone,
          carPlate: t.carPlate, comment: t.comment,
        } });
      }} />
    </>
  );
});

export default TemplatesTab;
