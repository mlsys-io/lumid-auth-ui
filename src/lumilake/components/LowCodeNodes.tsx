import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';

// Base node styles matching the image design
const baseNodeStyle = "bg-white border border-gray-300 rounded-lg min-w-24 min-h-16 shadow-sm";

// Define node data types
interface NodeData {
  label?: string;
  sublabel?: string;
  value?: string;
  text?: string;
  endpoint?: string;
  method?: string;
  table?: string;
  operation?: string;
  type?: string;
  condition?: string;
  onChange?: (id: string, newData: NodeData) => void;
}

// Input Node Component - matches CSV file in image
export const InputNode: React.FC<NodeProps> = ({ data }) => {
  const nodeData = (data as NodeData) || {};
  return (
    <div className={`${baseNodeStyle} flex flex-col items-center justify-center p-3`}>
      <div className="text-lg mb-1">📄</div>
      <div className="text-xs font-medium text-gray-900 text-center leading-tight">
        {nodeData.label || 'Data Input'}
      </div>
      {nodeData.sublabel && (
        <div className="text-xs text-gray-500 text-center">{nodeData.sublabel}</div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-2 !h-2" />
    </div>
  );
};

// Button Node Component
export const ButtonNode: React.FC<NodeProps> = ({ data }) => {
  const nodeData = (data as NodeData) || {};
  return (
    <div className={`${baseNodeStyle} flex flex-col items-center justify-center p-3`}>
      <div className="text-lg mb-1">🔘</div>
      <div className="text-xs font-medium text-gray-900 text-center leading-tight">
        {nodeData.label || 'Button'}
      </div>
      {nodeData.sublabel && (
        <div className="text-xs text-gray-500 text-center">{nodeData.sublabel}</div>
      )}
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-2 !h-2" />
    </div>
  );
};

// API Node Component
export const ApiNode: React.FC<NodeProps> = ({ data }) => {
  const nodeData = (data as NodeData) || {};
  return (
    <div className={`${baseNodeStyle} flex flex-col items-center justify-center p-3`}>
      <div className="text-lg mb-1">🌐</div>
      <div className="text-xs font-medium text-gray-900 text-center leading-tight">
        {nodeData.label || 'API Call'}
      </div>
      {nodeData.sublabel && (
        <div className="text-xs text-gray-500 text-center">{nodeData.sublabel}</div>
      )}
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-2 !h-2" />
    </div>
  );
};

// Database Node Component
export const DatabaseNode: React.FC<NodeProps> = ({ data }) => {
  const nodeData = (data as NodeData) || {};
  return (
    <div className={`${baseNodeStyle} flex flex-col items-center justify-center p-3`}>
      <div className="text-lg mb-1">🗄️</div>
      <div className="text-xs font-medium text-gray-900 text-center leading-tight">
        {nodeData.label || 'Database'}
      </div>
      {nodeData.sublabel && (
        <div className="text-xs text-gray-500 text-center">{nodeData.sublabel}</div>
      )}
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-2 !h-2" />
    </div>
  );
};

// Display Node Component
export const DisplayNode: React.FC<NodeProps> = ({ data }) => {
  const nodeData = (data as NodeData) || {};
  return (
    <div className={`${baseNodeStyle} flex flex-col items-center justify-center p-3`}>
      <div className="text-lg mb-1">📺</div>
      <div className="text-xs font-medium text-gray-900 text-center leading-tight">
        {nodeData.label || 'Display'}
      </div>
      {nodeData.sublabel && (
        <div className="text-xs text-gray-500 text-center">{nodeData.sublabel}</div>
      )}
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-2 !h-2" />
    </div>
  );
};

// Condition Node Component - matches the filter in image
export const ConditionNode: React.FC<NodeProps> = ({ data }) => {
  const nodeData = (data as NodeData) || {};
  return (
    <div className={`${baseNodeStyle} flex flex-col items-center justify-center p-3`}>
      <div className="text-lg mb-1">🔽</div>
      <div className="text-xs font-medium text-gray-900 text-center leading-tight">
        {nodeData.label || 'Filter'}
      </div>
      {nodeData.sublabel && (
        <div className="text-xs text-gray-500 text-center">{nodeData.sublabel}</div>
      )}
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-2 !h-2" />
    </div>
  );
}; 