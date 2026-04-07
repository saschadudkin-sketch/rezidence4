import { memo } from 'react';
import { MyTemplates } from '../../perms/PermsList';

type TemplatesTabProps = {
  user: { uid: string; role: string; name: string };
  setModal: (value: {
    type: string;
    cat: string;
    data: {
      visitorName: unknown;
      visitorPhone: unknown;
      carPlate: unknown;
      comment: unknown;
    };
  }) => void;
};

const TemplatesTab = memo(function TemplatesTab({ user, setModal }: TemplatesTabProps) {
  return (
    <MyTemplates
      user={user}
      onUse={(template) => {
        setModal({
          type: template.type,
          cat: template.category,
          data: {
            visitorName: template.visitorName,
            visitorPhone: template.visitorPhone,
            carPlate: template.carPlate,
            comment: template.comment,
          },
        });
      }}
    />
  );
});

export default TemplatesTab;
