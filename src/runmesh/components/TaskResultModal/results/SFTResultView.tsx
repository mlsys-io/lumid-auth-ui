import React from 'react';
import type { ISFTResult, ITaskConfig, ITaskDetail } from '@/runmesh/types/task';
import { Icons } from '@/runmesh/components/Icons';
import { useLanguage } from '@/runmesh/i18n';

export interface SFTResultViewProps {
  task: ITaskDetail;
  result: ISFTResult;
  config: ITaskConfig | null;
}

export const SFTResultView: React.FC<SFTResultViewProps> = ({ result, config }) => {
  const { t } = useLanguage();
  const spec = config?.spec;

  const canDownload = Boolean(result.final_model_archive_url);

  const handleDownload = () => {
    if (!result.final_model_archive_url) return;
    window.open(result.final_model_archive_url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-800">
          {t('taskResult.sft.title')}
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">{t('taskResult.sft.trainingLoss')}</div>
            <div className="text-lg font-semibold text-slate-900">
              {result.training_loss ?? 'N/A'}
            </div>
          </div>
          <div className="border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">{t('taskResult.sft.trainingSteps')}</div>
            <div className="text-lg font-semibold text-slate-900">
              {result.training_steps ?? 'N/A'}
            </div>
          </div>
          <div className="border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">{t('taskResult.sft.modelStatus')}</div>
            <div className="inline-flex items-center gap-2 text-green-700 font-semibold mt-1">
              <Icons.CheckCircle className="w-4 h-4" />
              {t('taskResult.sft.modelSaved')}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-800">
            {t('taskResult.sft.modelInfo')}
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!canDownload}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Icons.Download className="w-4 h-4" />
            {t('taskResult.sft.downloadModel')}
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <div>
            <div className="text-xs text-slate-500">{t('taskResult.sft.modelPath')}</div>
            <div className="font-mono text-slate-800 break-all">
              {result.final_model_path || 'N/A'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('taskResult.sft.archiveUrl')}</div>
            {result.final_model_archive_url ? (
              <a
                className="text-brand-700 hover:underline break-all"
                href={result.final_model_archive_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {result.final_model_archive_url}
              </a>
            ) : (
              <div className="text-slate-800">N/A</div>
            )}
          </div>
          {spec?.model?.source?.identifier && (
            <div>
              <div className="text-xs text-slate-500">{t('taskResult.sft.baseModel')}</div>
              <div className="inline-flex items-center px-2.5 py-1 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-semibold">
                {spec.model.source.identifier}
              </div>
            </div>
          )}
        </div>
      </div>

      {spec?.training && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-800">
            {t('taskResult.sft.training.title')}
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-slate-500">{t('taskResult.sft.training.epochs')}</div>
              <div className="text-slate-800">{spec.training.num_train_epochs ?? '-'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t('taskResult.sft.training.batchSize')}</div>
              <div className="text-slate-800">{spec.training.batch_size ?? '-'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">
                {t('taskResult.sft.training.learningRate')}
              </div>
              <div className="text-slate-800">{spec.training.learning_rate ?? '-'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">
                {t('taskResult.sft.training.maxSeqLength')}
              </div>
              <div className="text-slate-800">{spec.training.max_seq_length ?? '-'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">
                {t('taskResult.sft.training.gradientSteps')}
              </div>
              <div className="text-slate-800">
                {spec.training.gradient_accumulation_steps ?? '-'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t('taskResult.sft.training.saveSteps')}</div>
              <div className="text-slate-800">{spec.training.save_steps ?? '-'}</div>
            </div>
          </div>
        </div>
      )}

      {spec?.data && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-800">
            {t('taskResult.sft.dataset.title')}
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-slate-500">{t('taskResult.sft.dataset.name')}</div>
              <div className="text-slate-800">{spec.data.dataset_name ?? '-'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t('taskResult.sft.dataset.configName')}</div>
              <div className="text-slate-800">{spec.data.config_name ?? '-'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t('taskResult.sft.dataset.split')}</div>
              <div className="text-slate-800">{spec.data.split ?? '-'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t('taskResult.sft.dataset.maxSamples')}</div>
              <div className="text-slate-800">{spec.data.max_samples ?? '-'}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SFTResultView;
