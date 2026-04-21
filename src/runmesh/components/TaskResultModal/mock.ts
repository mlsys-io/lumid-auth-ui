import type { ITaskWithResult } from '@/runmesh/types/task';
import { translate } from '@/runmesh/i18n';

export const mockTaskDataById: Record<string, ITaskWithResult> = {
  '2012083974426980354': {
    task: {
      taskId: '2012083974426980354',
      taskNo: 'SFT',
      taskName: 'sft',
      taskType: 'sft',
      status: 'COMPLETED',
      submitTime: '2026-01-16 16:41:19',
      startTime: '2026-01-16 16:41:19',
      endTime: '2026-01-16 16:43:33',
      durationSeconds: 133,
      externalTaskId: '21669373-f194-46c5-942d-d6d02f2f48b0',
      graphNodeName: 'SFT',
      parsed: JSON.stringify(
        {
          apiVersion: 'v1',
          kind: 'Task',
          metadata: { name: 'sft', owner: 'demo-user' },
          spec: {
            taskType: 'sft',
            data: {
              dataset_name: 'alpaca',
              split: 'train',
              prompt_column: 'instruction',
              response_column: 'output',
              max_samples: 2000,
            },
            model: {
              source: { type: 'hf', identifier: 'meta-llama/Llama-3-8B-Instruct' },
            },
            training: {
              num_train_epochs: 1,
              batch_size: 2,
              learning_rate: 2e-5,
              max_seq_length: 2048,
              gradient_accumulation_steps: 8,
              save_steps: 100,
            },
            resources: { replicas: 1, hardware: { gpu: { type: 'A100', count: 1 } } },
          },
        },
        null,
        2,
      ),
      error: null,
      completed: true,
      failed: false,
      appName: 'Demo App',
      assignedWorker: 'worker-gpu-01',
      costAmount: '1.23',
      costCurrency: 'USD',
    },
    result: {
      task_id: '21669373-f194-46c5-942d-d6d02f2f48b0',
      result: {
        final_model_path: '/models/sft-demo-20260116',
        final_model_archive_url: 'https://example.com/model.tar.gz',
        training_loss: 0.15,
        training_steps: 500,
      },
    },
  },
  '2012079941939208194': {
    task: {
      taskId: '2012079941939208194',
      taskNo: 'Inference',
      taskName: 'inference',
      taskType: 'inference',
      status: 'COMPLETED',
      submitTime: '2026-01-16 15:11:02',
      startTime: '2026-01-16 15:11:05',
      endTime: '2026-01-16 15:12:10',
      durationSeconds: 65,
      externalTaskId: '4c8e5d4b-6d3a-4c0f-9f5f-39c5b6c8a9f1',
      graphNodeName: 'Inference',
      parsed: JSON.stringify(
        {
          apiVersion: 'v1',
          kind: 'Task',
          metadata: { name: 'inference', owner: 'demo-user' },
          spec: {
            taskType: 'inference',
            inference: {
              max_tokens: 256,
              temperature: 0.7,
              top_k: 40,
              top_p: 0.9,
              system_prompt: translate('taskResult.mock.inference.systemPrompt'),
            },
            model: {
              source: { type: 'hf', identifier: 'Qwen/Qwen2.5-7B-Instruct' },
              vllm: { gpu_memory_utilization: 0.9 },
            },
          },
        },
        null,
        2,
      ),
      error: null,
      completed: true,
      failed: false,
      appName: 'Demo App',
      assignedWorker: 'worker-gpu-02',
      costAmount: '0.08',
      costCurrency: 'USD',
    },
    result: {
      task_id: '4c8e5d4b-6d3a-4c0f-9f5f-39c5b6c8a9f1',
      result: {
        total_count: 12,
        success_count: 11,
        responses: Array.from({ length: 12 }).map((_, i) => ({
          question: translate('taskResult.mock.inference.question', { index: i + 1 }),
          answer: translate('taskResult.mock.inference.answer', { index: i + 1 }),
        })),
      },
    },
  },
};

export function getFallbackMock(taskId: string): ITaskWithResult {
  return {
    task: {
      taskId,
      taskNo: 'TASK',
      taskName: translate('taskResult.mock.fallback.taskName'),
      taskType: 'unknown',
      status: 'RUNNING',
      submitTime: '2026-01-16 00:00:00',
      startTime: '2026-01-16 00:00:10',
      durationSeconds: 10,
      externalTaskId: '',
      graphNodeName: 'Task',
      parsed: JSON.stringify(
        { apiVersion: 'v1', kind: 'Task', metadata: { name: 'unknown' }, spec: {} },
        null,
        2,
      ),
      error: null,
      completed: false,
      failed: false,
    },
  };
}
