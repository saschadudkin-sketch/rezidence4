import { memo } from 'react';
import { MyTemplates } from '../../perms/PermsList';
import type { RequestType } from '../../store/slices/requestsSlice';

type TemplatesTabProps = {
  user: { uid: string; role: string; name: string };
  setModal: (value: {
    type: RequestType;
    cat: string;
    data: {
      visitorName: unknown;
      visitorPhone: unknown;
      carPlate: unknown;
      comment: unknown;
    };
    initialStep?: number;
  }) => void;
};

const TemplatesTab = memo(function TemplatesTab({ user, setModal }: TemplatesTabProps) {
  return (
    <MyTemplates
      user={user}
      onUse={(template) => {
        setModal({
          type: template.type as RequestType,
          cat: template.category,
          data: {
            visitorName: template.visitorName,
            visitorPhone: template.visitorPhone,
            carPlate: template.carPlate,
            comment: template.comment,
          },
          initialStep: template.type === 'pass' ? 1 : undefined,
        });
      }}
    />
  );
});

export default TemplatesTab;
