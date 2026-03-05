
import React, { useState, useEffect } from 'react';
import { db } from '../services/db';
import { CashFlowExit, DocumentType } from '../types';
import { Button } from '../components/ui/Button';
import { Input, Select, CurrencyInput } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Plus } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

export const OutgoingBalances: React.FC = () => {
  const [items, setItems] = useState<CashFlowExit[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<CashFlowExit>>({});

  const refresh = () => setItems(db.getExits());
  useEffect(() => { refresh(); }, []);

  const handleSave = () => {
    if (!formData.value || !formData.documentNumber) return;

    const payload: CashFlowExit = {
      id: uuidv4(),
      date: formData.date || new Date().toISOString().split('T')[0],
      documentNumber: formData.documentNumber!,
      documentType: (formData.documentType as DocumentType) || DocumentType.EMPENHO,
      client: formData.client || '',
      value: Number(formData.value),
      rubric: formData.rubric || '',
      description: formData.description || '',
    };

    db.saveExit(payload);
    setIsModalOpen(false);
    setFormData({});
    refresh();
  };

  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">Saída de Saldos</h2>
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> Registrar Saída
        </Button>
      </div>

      <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Data</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Doc</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Cliente</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Descrição</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Valor Saída</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {items.map(item => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 text-sm text-slate-500">{new Date(item.date).toLocaleDateString()}</td>
                <td className="px-6 py-4 text-sm font-medium text-slate-900">{item.documentNumber} <span className="text-xs text-slate-400">({item.documentType})</span></td>
                <td className="px-6 py-4 text-sm text-slate-500">{item.client}</td>
                <td className="px-6 py-4 text-sm text-slate-500">{item.description}</td>
                <td className="px-6 py-4 text-sm text-right font-medium text-red-600">- R$ {item.value.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Nova Saída Financeira"
        footer={<div className="flex justify-end gap-2"><Button onClick={handleSave}>Confirmar Saída</Button></div>}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Data" type="date" required value={formData.date || ''} onChange={e => setFormData({...formData, date: e.target.value})} />
          <Input label="Número Documento" required value={formData.documentNumber || ''} onChange={e => setFormData({...formData, documentNumber: e.target.value})} />
          <Select label="Tipo Doc" options={[{label:'Empenho', value:'EMPENHO'}, {label:'ALTCRED', value:'ALTCRED'}]} value={formData.documentType || ''} onChange={e => setFormData({...formData, documentType: e.target.value as any})} />
          <Input label="Cliente" required value={formData.client || ''} onChange={e => setFormData({...formData, client: e.target.value})} />
          
          <CurrencyInput label="Valor Saída" value={formData.value} onChange={val => setFormData({...formData, value: val})} />
          
          <Input label="Rubrica" value={formData.rubric || ''} onChange={e => setFormData({...formData, rubric: e.target.value})} />
          <Input label="Descrição" className="md:col-span-2" value={formData.description || ''} onChange={e => setFormData({...formData, description: e.target.value})} />
        </div>
      </Modal>
    </div>
  );
};
