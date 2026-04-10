import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { locationsApi, cnpjApi, accountsApi } from '../lib/api';
import { maskPhone } from '../lib/formatters';

// ==================== TYPES ====================

interface CompanyData {
    cnpj: string;
    legalName: string;
    tradeName?: string;
    address?: string;
    city?: string;
    state?: string;
}

interface ContactData {
    name: string;
    role?: string;
    email?: string;
    phone?: string;
    whatsapp?: string;
    isPrimary: boolean;
}

interface AdminUserData {
    email: string;
    password: string;
    confirmPassword: string;
    name: string;
}

// ==================== UTILS ====================

// CNPJ mask: XX.XXX.XXX/XXXX-XX (14 dígitos = 18 caracteres com formatação)
function maskCNPJ(value: string): string {
    const numbers = value.replace(/\D/g, '');
    // Limit to exactly 14 digits
    const limited = numbers.slice(0, 14);
    if (limited.length === 0) return '';
    if (limited.length <= 2) return limited;
    if (limited.length <= 5) return limited.replace(/^(\d{2})(\d)/, '$1.$2');
    if (limited.length <= 8) return limited.replace(/^(\d{2})(\d{3})(\d)/, '$1.$2.$3');
    if (limited.length <= 12) return limited.replace(/^(\d{2})(\d{3})(\d{3})(\d)/, '$1.$2.$3/$4');
    // Full format for 13-14 digits
    return limited.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

// Validate CNPJ
function validateCNPJ(cnpj: string): boolean {
    const cleanCNPJ = cnpj.replace(/\D/g, '');
    if (cleanCNPJ.length !== 14) return false;
    
    // Check for known invalid patterns
    if (/^(\d)\1+$/.test(cleanCNPJ)) return false;
    
    // Validate check digits (simplified - in production use full algorithm)
    return true;
}

// ==================== COMPONENT ====================

const steps = [
    { id: 1, title: 'Dados da Empresa', desc: 'Informações básicas' },
    { id: 2, title: 'Contatos', desc: 'Pessoas e tomador de decisão' },
    { id: 3, title: 'Usuário Admin', desc: 'Primeiro acesso' },
    { id: 4, title: 'CNPJs Adicionais', desc: 'Opcional' },
    { id: 5, title: 'Revisão', desc: 'Confirme os dados' },
];

const CompanyOnboarding: React.FC = () => {
    const navigate = useNavigate();
    const [currentStep, setCurrentStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    // States for locations
    const [states, setStates] = useState<Array<{ code: string; name: string }>>([]);
    const [cities, setCities] = useState<Array<{ id: string; name: string; state: { code: string } }>>([]);
    const [loadingCNPJ, setLoadingCNPJ] = useState(false);
    const [loadingCEP, setLoadingCEP] = useState(false);
    const [cep, setCep] = useState('');
    
    // Step 1: Account & Primary Company
    const [accountName, setAccountName] = useState('');
    const [accountType, setAccountType] = useState<'COMPANY' | 'INDIVIDUAL'>('COMPANY');
    const [primaryCompany, setPrimaryCompany] = useState<CompanyData>({
        cnpj: '',
        legalName: '',
        tradeName: '',
        address: '',
        city: '',
        state: '',
    });
    
    // Step 2: Contacts
    const [contacts, setContacts] = useState<ContactData[]>([
        { name: '', isPrimary: true }
    ]);
    
    // Step 3: Admin User
    const [adminUser, setAdminUser] = useState<AdminUserData>({
        email: '',
        password: '',
        confirmPassword: '',
        name: '',
    });
    
    // Step 4: Additional Companies
    const [additionalCompanies, setAdditionalCompanies] = useState<CompanyData[]>([]);

    // Validation warnings (step 1 & 3)
    const [cnpjExistsWarning, setCnpjExistsWarning] = useState<string | null>(null);
    const [emailExistsWarning, setEmailExistsWarning] = useState(false);
    const [loadingEmailCheck, setLoadingEmailCheck] = useState(false);
    
    const next = async () => {
        if (currentStep === 3) {
            const email = adminUser.email?.trim?.();
            if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                setLoadingEmailCheck(true);
                try {
                    const r = await accountsApi.checkEmail(email);
                    if (r.exists) {
                        setEmailExistsWarning(true);
                        return;
                    }
                } catch {
                    // ignore
                } finally {
                    setLoadingEmailCheck(false);
                }
            }
        }
        setCurrentStep(prev => Math.min(prev + 1, steps.length));
    };
    const back = () => setCurrentStep(prev => Math.max(prev - 1, 1));
    
    // Load states on mount
    useEffect(() => {
        locationsApi.getStates().then(res => {
            if (res.success) {
                setStates(res.data);
            }
        }).catch(err => {
            console.error('Error loading states:', err);
        });
    }, []);
    
    // Load cities when state changes
    useEffect(() => {
        if (primaryCompany.state && primaryCompany.state.length === 2) {
            locationsApi.getCities({ state: primaryCompany.state }).then(res => {
                if (res.success) {
                    setCities(res.data);
                }
            }).catch(err => {
                console.error('Error loading cities:', err);
            });
        } else {
            setCities([]);
        }
    }, [primaryCompany.state]);
    
    // Debounce function
    const debounce = useCallback((func: Function, wait: number) => {
        let timeout: NodeJS.Timeout;
        return function executedFunction(...args: any[]) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }, []);
    
    // CEP lookup
    const handleCEPLookup = useCallback(async (cepValue: string) => {
        const cleanCEP = cepValue.replace(/\D/g, '');
        if (cleanCEP.length === 8) {
            setLoadingCEP(true);
            try {
                const response = await locationsApi.getCEP(cleanCEP);
                if (response.success && response.data) {
                    const data = response.data;
                    setPrimaryCompany(prev => ({
                        ...prev,
                        address: data.logradouro ? `${data.logradouro}${data.bairro ? ', ' + data.bairro : ''}` : prev.address,
                        city: data.cidade || prev.city,
                        state: data.uf || prev.state,
                    }));
                }
            } catch (err: any) {
                console.log('CEP lookup failed:', err.message);
            } finally {
                setLoadingCEP(false);
            }
        }
    }, []);
    
    // CNPJ lookup with debounce
    const handleCNPJLookup = useCallback(
        debounce(async (cnpj: string) => {
            const cleanCNPJ = cnpj.replace(/\D/g, '');
            if (cleanCNPJ.length === 14) {
                setLoadingCNPJ(true);
                try {
                    const response = await cnpjApi.consult(cleanCNPJ);
                    if (response.success && response.data) {
                        const data = response.data;
                        setPrimaryCompany(prev => ({
                            ...prev,
                            // Use data from API if it exists and is not empty, otherwise keep existing value
                            legalName: (data.legalName && data.legalName.trim() !== '') ? data.legalName : prev.legalName,
                            tradeName: (data.tradeName && data.tradeName.trim() !== '') ? data.tradeName : prev.tradeName,
                            address: data.address?.street 
                                ? `${data.address.street}${data.address.number ? ', ' + data.address.number : ''}${data.address.complement ? ' - ' + data.address.complement : ''}`
                                : prev.address,
                            city: (data.address?.city && data.address.city.trim() !== '') ? data.address.city : prev.city,
                            state: (data.address?.state && data.address.state.trim() !== '') ? data.address.state : prev.state,
                        }));
                        
                        // If CEP is available, also fetch full address
                        if (data.address?.zipCode) {
                            handleCEPLookup(data.address.zipCode);
                        }
                        // Check if CNPJ already registered
                        try {
                            const check = await accountsApi.checkCnpj(cleanCNPJ);
                            if (check.exists) {
                                setCnpjExistsWarning(check.accountName
                                    ? `Este CNPJ já está cadastrado em outra conta (${check.accountName}).`
                                    : 'Este CNPJ já está cadastrado em outra conta.');
                            } else {
                                setCnpjExistsWarning(null);
                            }
                        } catch {
                            setCnpjExistsWarning(null);
                        }
                    }
                } catch (err: any) {
                    console.log('CNPJ lookup failed:', err.message);
                } finally {
                    setLoadingCNPJ(false);
                }
            }
        }, 1000),
        [handleCEPLookup]
    );
    
    // CEP mask
    const maskCEP = (value: string): string => {
        const numbers = value.replace(/\D/g, '');
        if (numbers.length <= 8) {
            return numbers.replace(/^(\d{5})(\d)/, '$1-$2');
        }
        return value;
    };
    
    // ==================== STEP VALIDATION ====================
    
    const isStepValid = () => {
        if (currentStep === 1) {
            return accountName.trim() !== '' &&
                   primaryCompany.cnpj.replace(/\D/g, '').length === 14 &&
                   primaryCompany.legalName.trim() !== '' &&
                   !cnpjExistsWarning;
        }
        if (currentStep === 2) {
            return contacts.length > 0 &&
                   contacts.every(c => c.name.trim() !== '') &&
                   contacts.some(c => c.isPrimary);
        }
        if (currentStep === 3) {
            return adminUser.email.trim() !== '' &&
                   adminUser.password.length >= 6 &&
                   adminUser.password === adminUser.confirmPassword &&
                   adminUser.name.trim() !== '' &&
                   !emailExistsWarning;
        }
        return true; // Steps 4 and 5 are optional/review
    };

    const handleEmailBlur = useCallback(async () => {
        const email = adminUser.email?.trim?.();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setEmailExistsWarning(false);
            return;
        }
        setLoadingEmailCheck(true);
        setEmailExistsWarning(false);
        try {
            const r = await accountsApi.checkEmail(email);
            setEmailExistsWarning(r.exists);
        } catch {
            setEmailExistsWarning(false);
        } finally {
            setLoadingEmailCheck(false);
        }
    }, [adminUser.email]);
    
    // ==================== HANDLERS ====================
    
    const handleCNPJChange = (value: string, setter: (data: CompanyData) => void, currentData: CompanyData) => {
        const masked = maskCNPJ(value);
        setCnpjExistsWarning(null);
        setter({ ...currentData, cnpj: masked });
        // Trigger CNPJ lookup if complete
        if (masked.replace(/\D/g, '').length === 14) {
            handleCNPJLookup(masked);
        }
    };
    
    const addContact = () => {
        setContacts([...contacts, { name: '', isPrimary: false }]);
    };
    
    const removeContact = (index: number) => {
        if (contacts.length > 1) {
            const newContacts = contacts.filter((_, i) => i !== index);
            // Ensure at least one is primary
            if (!newContacts.some(c => c.isPrimary) && newContacts.length > 0) {
                newContacts[0].isPrimary = true;
            }
            setContacts(newContacts);
        }
    };
    
    const updateContact = (index: number, field: keyof ContactData, value: any) => {
        const newContacts = [...contacts];
        if (field === 'isPrimary' && value) {
            // Unset other primaries
            newContacts.forEach((c, i) => {
                c.isPrimary = i === index;
            });
        } else {
            newContacts[index] = { ...newContacts[index], [field]: value };
        }
        setContacts(newContacts);
    };
    
    const addCompany = () => {
        setAdditionalCompanies([...additionalCompanies, {
            cnpj: '',
            legalName: '',
            tradeName: '',
            address: '',
            city: '',
            state: '',
        }]);
    };
    
    const removeCompany = (index: number) => {
        setAdditionalCompanies(additionalCompanies.filter((_, i) => i !== index));
    };
    
    const updateCompany = (index: number, field: keyof CompanyData, value: string) => {
        const newCompanies = [...additionalCompanies];
        newCompanies[index] = { ...newCompanies[index], [field]: value };
        setAdditionalCompanies(newCompanies);
    };
    
    // CNPJ lookup for additional companies with debounce (per index)
    const additionalCNPJLookups = useRef<Map<number, NodeJS.Timeout>>(new Map());
    
    // Handle CNPJ change for additional companies with lookup
    const handleAdditionalCNPJChange = (index: number, value: string) => {
        const masked = maskCNPJ(value);
        
        // Update CNPJ immediately
        setAdditionalCompanies(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], cnpj: masked };
            return updated;
        });
        
        // Clear previous timeout for this index
        if (additionalCNPJLookups.current.has(index)) {
            clearTimeout(additionalCNPJLookups.current.get(index)!);
        }
        
        const cleanCNPJ = masked.replace(/\D/g, '');
        
        // Only trigger lookup if CNPJ is complete (14 digits) with debounce
        if (cleanCNPJ.length === 14) {
            // Capture the masked value to preserve it in the closure
            const capturedMasked = masked;
            const timeoutId = setTimeout(async () => {
                try {
                    const response = await cnpjApi.consult(cleanCNPJ);
                    if (response.success && response.data) {
                        const data = response.data;
                        // Use the SAME logic as primary company - update ALL fields
                        setAdditionalCompanies(prev => {
                            const updated = [...prev];
                            updated[index] = {
                                ...updated[index],
                                // Preserve CNPJ that was typed (use captured value)
                                cnpj: capturedMasked,
                                // Update ALL fields from API (same as primary company)
                                legalName: (data.legalName && data.legalName.trim() !== '') ? data.legalName : updated[index].legalName,
                                tradeName: (data.tradeName && data.tradeName.trim() !== '') ? data.tradeName : updated[index].tradeName,
                                address: data.address?.street 
                                    ? `${data.address.street}${data.address.number ? ', ' + data.address.number : ''}${data.address.complement ? ' - ' + data.address.complement : ''}`
                                    : updated[index].address,
                                city: (data.address?.city && data.address.city.trim() !== '') ? data.address.city : updated[index].city,
                                state: (data.address?.state && data.address.state.trim() !== '') ? data.address.state : updated[index].state,
                            };
                            return updated;
                        });
                        
                        // If CEP is available, also fetch full address (same as primary company)
                        if (data.address?.zipCode) {
                            try {
                                const cepResponse = await locationsApi.getCEP(data.address.zipCode);
                                if (cepResponse.success && cepResponse.data) {
                                    const cepData = cepResponse.data;
                                    setAdditionalCompanies(prev => {
                                        const updated = [...prev];
                                        updated[index] = {
                                            ...updated[index],
                                            // Preserve all fields, update address/city/state from CEP
                                            address: cepData.logradouro ? `${cepData.logradouro}${cepData.bairro ? ', ' + cepData.bairro : ''}` : updated[index].address,
                                            city: cepData.cidade || updated[index].city,
                                            state: cepData.uf || updated[index].state,
                                        };
                                        return updated;
                                    });
                                }
                            } catch (cepErr) {
                                // Silently fail CEP lookup
                                console.log('CEP lookup failed for additional company:', cepErr);
                            }
                        }
                    }
                } catch (err: any) {
                    console.log('CNPJ lookup failed for additional company:', err.message);
                }
                // Remove timeout from map
                additionalCNPJLookups.current.delete(index);
            }, 1000); // 1 second debounce
            
            additionalCNPJLookups.current.set(index, timeoutId);
        } else {
            // Clear timeout if CNPJ is not complete
            additionalCNPJLookups.current.delete(index);
        }
    };
    
    // ==================== SUBMIT ====================
    
    const handleSubmit = async () => {
        setLoading(true);
        setError(null);
        
        try {
            const API_URL = import.meta.env.DEV ? 'http://localhost:3002/api' : '/api';
            
            // Validate required fields before sending
            if (!primaryCompany.legalName || primaryCompany.legalName.trim() === '') {
                throw new Error('Razão Social é obrigatória');
            }
            
            if (!primaryCompany.cnpj || primaryCompany.cnpj.replace(/\D/g, '').length !== 14) {
                throw new Error('CNPJ inválido');
            }

            // Prepare payload with validated data
            const payload = {
                accountName: accountName.trim(),
                accountType,
                primaryCompany: {
                    cnpj: primaryCompany.cnpj.replace(/\D/g, ''), // Remove formatting
                    legalName: primaryCompany.legalName?.trim() || '',
                    tradeName: primaryCompany.tradeName?.trim() || undefined,
                    address: primaryCompany.address?.trim() || undefined,
                    city: primaryCompany.city?.trim() || undefined,
                    state: primaryCompany.state?.trim().toUpperCase() || undefined,
                },
                contacts: contacts
                    .filter(c => c.name.trim() !== '')
                    .map(c => ({
                        name: c.name.trim(),
                        role: c.role?.trim() || undefined,
                        email: c.email?.trim() || undefined,
                        phone: c.phone?.trim() || undefined,
                        whatsapp: c.whatsapp?.trim() || undefined,
                        isPrimary: c.isPrimary || false,
                    })),
                adminUser: {
                    email: adminUser.email.trim(),
                    password: adminUser.password,
                    name: adminUser.name.trim(),
                },
                additionalCompanies: additionalCompanies
                    .filter(c => c.cnpj.replace(/\D/g, '').length === 14)
                    .map(c => ({
                        cnpj: c.cnpj.replace(/\D/g, ''),
                        legalName: c.legalName.trim(),
                        tradeName: c.tradeName?.trim() || undefined,
                        address: c.address?.trim() || undefined,
                        city: c.city?.trim() || undefined,
                        state: c.state?.trim().toUpperCase() || undefined,
                    })),
            };

            const response = await fetch(`${API_URL}/accounts/onboarding`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Erro ao criar conta');
            }
            
            const { data } = await response.json();
            
            // Save token and redirect to login
            if (data.token) {
                localStorage.setItem('token', data.token);
                alert('Conta criada com sucesso! Redirecionando...');
                navigate('/login');
            } else {
                navigate('/login');
            }
        } catch (err: any) {
            console.error('Erro ao criar conta:', err);
            setError(err.message || 'Erro ao criar conta. Verifique os dados e tente novamente.');
        } finally {
            setLoading(false);
        }
    };
    
    // ==================== RENDER ====================
    
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 py-12 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="text-center mb-10">
                    <div className="flex items-center justify-center gap-3 mb-4">
                        <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center">
                            <span className="text-white font-bold text-2xl">TSM</span>
                        </div>
                        <div className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
                            EX OMNI
                        </div>
                    </div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-slate-100 mb-2">
                        Criar Conta Empresarial
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        Configure sua conta com múltiplos CNPJs e usuários
                    </p>
                </div>
                
                {/* Stepper */}
                <div className="flex justify-between mb-12 relative">
                    <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-200 -z-10 -translate-y-1/2"></div>
                    {steps.map(step => (
                        <div key={step.id} className="flex flex-col items-center bg-slate-50 px-3">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold border-2 transition-all ${
                                currentStep >= step.id
                                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100'
                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
                            }`}>
                                {step.id}
                            </div>
                            <span className={`text-[10px] mt-3 font-black uppercase tracking-widest ${
                                currentStep === step.id ? 'text-indigo-600' : 'text-slate-400'
                            }`}>
                                {step.title}
                            </span>
                        </div>
                    ))}
                </div>
                
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-xl mb-6">
                        {error}
                    </div>
                )}
                
                {/* Step Content */}
                <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-xl shadow-slate-200/50 border border-slate-100 p-8 md:p-12">
                    {/* Step 1: Dados da Empresa */}
                    {currentStep === 1 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                    Nome da Empresa / Conta
                                </label>
                                <input
                                    type="text"
                                    placeholder="Ex: Empresa ABC Ltda"
                                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium text-slate-700"
                                    value={accountName}
                                    onChange={e => setAccountName(e.target.value)}
                                />
                            </div>
                            
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                    Tipo
                                </label>
                                <div className="flex gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setAccountType('COMPANY')}
                                        className={`flex-1 p-4 rounded-xl border-2 font-bold transition-all ${
                                            accountType === 'COMPANY'
                                                ? 'bg-indigo-50 border-indigo-500 text-indigo-600'
                                                : 'bg-slate-50 border-slate-200 dark:border-slate-700 text-slate-400'
                                        }`}
                                    >
                                        Empresa
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setAccountType('INDIVIDUAL')}
                                        className={`flex-1 p-4 rounded-xl border-2 font-bold transition-all ${
                                            accountType === 'INDIVIDUAL'
                                                ? 'bg-indigo-50 border-indigo-500 text-indigo-600'
                                                : 'bg-slate-50 border-slate-200 dark:border-slate-700 text-slate-400'
                                        }`}
                                    >
                                        Pessoa Física
                                    </button>
                                </div>
                            </div>
                            
                            <div className="border-t border-slate-100 pt-6">
                                <h3 className="text-sm font-bold text-slate-700 mb-4">CNPJ Principal</h3>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                            CNPJ {loadingCNPJ && <span className="text-indigo-500 text-xs">(Buscando...)</span>}
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="00.000.000/0000-00"
                                            maxLength={18}
                                            className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                            value={primaryCompany.cnpj}
                                            onChange={e => handleCNPJChange(e.target.value, setPrimaryCompany, primaryCompany)}
                                        />
                                        {cnpjExistsWarning && (
                                            <p className="text-amber-700 text-sm mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                                {cnpjExistsWarning}
                                            </p>
                                        )}
                                        <p className="text-xs text-slate-400 mt-1">Digite o CNPJ para buscar dados automaticamente</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                            Razão Social
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="Razão Social Completa"
                                            className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                            value={primaryCompany.legalName}
                                            onChange={e => setPrimaryCompany({ ...primaryCompany, legalName: e.target.value })}
                                        />
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                            Nome Fantasia (Opcional)
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="Nome Fantasia"
                                            className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                            value={primaryCompany.tradeName || ''}
                                            onChange={e => setPrimaryCompany({ ...primaryCompany, tradeName: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                            Endereço
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="Rua, número, complemento"
                                            className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                            value={primaryCompany.address || ''}
                                            onChange={e => setPrimaryCompany({ ...primaryCompany, address: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                            CEP {loadingCEP && <span className="text-indigo-500 text-xs">(Buscando...)</span>}
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="00000-000"
                                            maxLength={9}
                                            className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                            value={cep}
                                            onChange={e => {
                                                const masked = maskCEP(e.target.value);
                                                setCep(masked);
                                                const cleanCEP = masked.replace(/\D/g, '');
                                                if (cleanCEP.length === 8) {
                                                    handleCEPLookup(cleanCEP);
                                                }
                                            }}
                                        />
                                        <p className="text-xs text-slate-400 mt-1">Digite o CEP para buscar endereço automaticamente</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                            Estado
                                        </label>
                                        <select
                                            className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                            value={primaryCompany.state || ''}
                                            onChange={e => setPrimaryCompany({ ...primaryCompany, state: e.target.value, city: '' })}
                                        >
                                            <option value="">Selecione o estado</option>
                                            {states.map(state => (
                                                <option key={state.code} value={state.code}>
                                                    {state.name} ({state.code})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                            Cidade
                                        </label>
                                        <select
                                            className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                            value={primaryCompany.city || ''}
                                            onChange={e => setPrimaryCompany({ ...primaryCompany, city: e.target.value })}
                                            disabled={!primaryCompany.state || cities.length === 0}
                                        >
                                            <option value="">Selecione a cidade</option>
                                            {cities.map(city => (
                                                <option key={city.id} value={city.name}>
                                                    {city.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {/* Step 2: Contatos */}
                    {currentStep === 2 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-sm font-bold text-slate-700">Contatos da Empresa</h3>
                                <button
                                    type="button"
                                    onClick={addContact}
                                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 transition-colors"
                                >
                                    + Adicionar Contato
                                </button>
                            </div>
                            
                            {contacts.map((contact, index) => (
                                <div key={index} className="border-2 border-slate-100 rounded-2xl p-6 space-y-4">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-xs font-bold text-slate-400 uppercase">Contato {index + 1}</span>
                                        {contacts.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => removeContact(index)}
                                                className="text-red-500 hover:text-red-700 text-sm font-medium"
                                            >
                                                Remover
                                            </button>
                                        )}
                                    </div>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                                Nome *
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="Nome completo"
                                                className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                                value={contact.name}
                                                onChange={e => updateContact(index, 'name', e.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                                Cargo
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="Ex: Gerente de Logística"
                                                className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                                value={contact.role || ''}
                                                onChange={e => updateContact(index, 'role', e.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                                Email
                                            </label>
                                            <input
                                                type="email"
                                                placeholder="email@exemplo.com"
                                                className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                                value={contact.email || ''}
                                                onChange={e => updateContact(index, 'email', e.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                                Telefone
                                            </label>
                                            <input
                                                type="tel"
                                                placeholder="(11) 99999-9999"
                                                className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                                value={maskPhone(contact.phone || '')}
                                                onChange={e => updateContact(index, 'phone', e.target.value.replace(/\D/g, ''))}
                                                maxLength={15}
                                            />
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            id={`primary-${index}`}
                                            checked={contact.isPrimary}
                                            onChange={e => updateContact(index, 'isPrimary', e.target.checked)}
                                            className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                                        />
                                        <label htmlFor={`primary-${index}`} className="text-sm font-medium text-slate-700">
                                            Tomador de Decisão
                                        </label>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    
                    {/* Step 3: Usuário Admin */}
                    {currentStep === 3 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-4">
                                <p className="text-sm text-indigo-800">
                                    Este será o primeiro usuário da conta e terá acesso administrativo para gerenciar CNPJs e outros usuários.
                                </p>
                            </div>
                            
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                    Nome do Usuário
                                </label>
                                <input
                                    type="text"
                                    placeholder="Nome completo"
                                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium text-slate-700"
                                    value={adminUser.name}
                                    onChange={e => setAdminUser({ ...adminUser, name: e.target.value })}
                                />
                            </div>
                            
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                    Email {loadingEmailCheck && <span className="text-indigo-500 text-xs">(Verificando...)</span>}
                                </label>
                                <input
                                    type="email"
                                    placeholder="seu@email.com"
                                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium text-slate-700"
                                    value={adminUser.email}
                                    onChange={e => { setAdminUser({ ...adminUser, email: e.target.value }); setEmailExistsWarning(false); }}
                                    onBlur={handleEmailBlur}
                                />
                                {emailExistsWarning && (
                                    <p className="text-amber-700 text-sm mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                        Este e-mail já possui cadastro no sistema.
                                    </p>
                                )}
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                        Senha
                                    </label>
                                    <input
                                        type="password"
                                        placeholder="Mínimo 6 caracteres"
                                        className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                        value={adminUser.password}
                                        onChange={e => setAdminUser({ ...adminUser, password: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                        Confirmar Senha
                                    </label>
                                    <input
                                        type="password"
                                        placeholder="Repita a senha"
                                        className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                        value={adminUser.confirmPassword}
                                        onChange={e => setAdminUser({ ...adminUser, confirmPassword: e.target.value })}
                                    />
                                    {adminUser.password && adminUser.password !== adminUser.confirmPassword && (
                                        <p className="text-red-500 text-xs mt-1">Senhas não coincidem</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {/* Step 4: CNPJs Adicionais */}
                    {currentStep === 4 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="bg-slate-50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-4">
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    Adicione outros CNPJs da mesma empresa ou filiais. Todos compartilharão as mesmas tabelas de preço especiais.
                                </p>
                            </div>
                            
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-sm font-bold text-slate-700">CNPJs Adicionais</h3>
                                <button
                                    type="button"
                                    onClick={addCompany}
                                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 transition-colors"
                                >
                                    + Adicionar CNPJ
                                </button>
                            </div>
                            
                            {additionalCompanies.length === 0 ? (
                                <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
                                    <p>Nenhum CNPJ adicional adicionado.</p>
                                    <p className="text-xs mt-2">Você pode pular esta etapa e adicionar depois.</p>
                                </div>
                            ) : (
                                additionalCompanies.map((company, index) => (
                                    <div key={index} className="border-2 border-slate-100 rounded-2xl p-6 space-y-4">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-xs font-bold text-slate-400 uppercase">CNPJ {index + 1}</span>
                                            <button
                                                type="button"
                                                onClick={() => removeCompany(index)}
                                                className="text-red-500 hover:text-red-700 text-sm font-medium"
                                            >
                                                Remover
                                            </button>
                                        </div>
                                        
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                                    CNPJ
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="00.000.000/0000-00"
                                                    maxLength={18}
                                                    className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                                    value={company.cnpj}
                                                    onChange={e => handleAdditionalCNPJChange(index, e.target.value)}
                                                />
                                                <p className="text-xs text-slate-400 mt-1">Digite o CNPJ para buscar dados automaticamente</p>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                                    Razão Social
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="Razão Social"
                                                    className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                                    value={company.legalName}
                                                    onChange={e => updateCompany(index, 'legalName', e.target.value)}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                                    Nome Fantasia
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="Nome Fantasia"
                                                    className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                                    value={company.tradeName || ''}
                                                    onChange={e => updateCompany(index, 'tradeName', e.target.value)}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                                    Cidade / Estado
                                                </label>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <input
                                                        type="text"
                                                        placeholder="Cidade"
                                                        className="p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium"
                                                        value={company.city || ''}
                                                        onChange={e => updateCompany(index, 'city', e.target.value)}
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="UF"
                                                        maxLength={2}
                                                        className="p-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-indigo-500 focus:bg-white dark:bg-slate-800 outline-none transition-all font-medium uppercase"
                                                        value={company.state || ''}
                                                        onChange={e => updateCompany(index, 'state', e.target.value.toUpperCase())}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                    
                    {/* Step 5: Revisão */}
                    {currentStep === 5 && (
                        <div className="space-y-6 animate-in fade-in zoom-in duration-500">
                            <div className="bg-indigo-900 rounded-3xl p-8 text-white relative overflow-hidden">
                                <div className="absolute -top-12 -right-12 w-48 h-48 bg-white dark:bg-slate-800/10 rounded-full blur-3xl"></div>
                                <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                    </svg>
                                    Revisão dos Dados
                                </h3>
                                
                                <div className="space-y-4 text-sm">
                                    <div>
                                        <span className="text-indigo-300 block mb-1">Nome da Conta</span>
                                        <span className="font-bold text-lg">{accountName}</span>
                                    </div>
                                    <div>
                                        <span className="text-indigo-300 block mb-1">Tipo</span>
                                        <span className="font-bold text-lg">{accountType === 'COMPANY' ? 'Empresa' : 'Pessoa Física'}</span>
                                    </div>
                                    <div>
                                        <span className="text-indigo-300 block mb-1">CNPJ Principal</span>
                                        <span className="font-bold text-lg">{primaryCompany.cnpj} - {primaryCompany.legalName}</span>
                                    </div>
                                    <div>
                                        <span className="text-indigo-300 block mb-1">Contatos</span>
                                        <span className="font-bold text-lg">{contacts.filter(c => c.name.trim() !== '').length} contato(s)</span>
                                    </div>
                                    <div>
                                        <span className="text-indigo-300 block mb-1">Usuário Admin</span>
                                        <span className="font-bold text-lg">{adminUser.email}</span>
                                    </div>
                                    {additionalCompanies.length > 0 && (
                                        <div>
                                            <span className="text-indigo-300 block mb-1">CNPJs Adicionais</span>
                                            <span className="font-bold text-lg">{additionalCompanies.length} CNPJ(s)</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {/* Navigation */}
                    <div className="flex justify-between mt-12 pt-8 border-t border-slate-100">
                        <button
                            onClick={back}
                            disabled={currentStep === 1 || loading}
                            className="px-6 py-3 font-bold text-slate-400 hover:text-indigo-600 disabled:opacity-30 transition-colors uppercase tracking-widest text-xs"
                        >
                            Voltar
                        </button>
                        
                        {currentStep < steps.length ? (
                            <button
                                onClick={() => next()}
                                disabled={!isStepValid()}
                                className="px-10 py-4 bg-indigo-600 text-white font-black rounded-2xl hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 disabled:opacity-50 disabled:shadow-none uppercase tracking-tighter"
                            >
                                Continuar
                            </button>
                        ) : (
                            <button
                                onClick={handleSubmit}
                                disabled={loading || !isStepValid()}
                                className="px-10 py-4 bg-emerald-500 text-white font-black rounded-2xl hover:bg-emerald-600 transition-all shadow-xl shadow-emerald-100 flex items-center gap-3 uppercase tracking-tighter disabled:opacity-50"
                            >
                                {loading ? (
                                    <span className="animate-pulse">Criando Conta...</span>
                                ) : (
                                    <>
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                                        </svg>
                                        Criar Conta
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CompanyOnboarding;
