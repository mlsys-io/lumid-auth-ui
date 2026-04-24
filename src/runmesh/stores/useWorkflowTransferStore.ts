import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface WorkflowTransferState {
  definitionJson: string | null;
  name: string | null;
  description: string | null;
  setDefinitionData: (data: { definitionJson: string; name: string; description: string }) => void;
  consumeTransferData: () => {
    definitionJson: string | null;
    name: string | null;
    description: string | null;
  };
  clear: () => void;
}

export const useWorkflowTransferStore = create<WorkflowTransferState>()(
  persist(
    (set, get) => ({
      definitionJson: null,
      name: null,
      description: null,
      setDefinitionData: (data) =>
        set({
          definitionJson: data.definitionJson,
          name: data.name,
          description: data.description,
        }),
      consumeTransferData: () => {
        const { definitionJson, name, description } = get();
        set({ definitionJson: null, name: null, description: null });
        return { definitionJson, name, description };
      },
      clear: () => set({ definitionJson: null, name: null, description: null }),
    }),
    {
      name: 'workflow-transfer',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
