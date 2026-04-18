import React from 'react';

interface DataTableProps {
  children: React.ReactNode;
  className?: string;
}

/** Contêiner padrão para tabelas: scroll horizontal, borda, cantos arredondados */
const DataTable: React.FC<DataTableProps> = ({ children, className = '' }) => (
  <div
    className={`overflow-x-auto rounded-xl border border-tower-200 bg-white shadow-sm dark:border-tower-700 dark:bg-tower-900/80 ${className}`}
  >
    <table className="min-w-full divide-y divide-tower-200 text-left text-sm dark:divide-tower-700">{children}</table>
  </div>
);

export default DataTable;
