import { describe, expect, it } from 'vitest';
import {
    ATTACHMENT_MAX_BYTES,
    attachmentBody,
    attachmentProblem,
    canChangeStatusManually,
    friendlyOrderError,
    noteBody,
    noteProblem,
    statusBody,
    statusProblem,
    statusTargets,
    trackingPath,
    trackingUrl,
} from './pedidoDrawer';

describe('pedidoDrawer', () => {
    it('recusa arquivos ativos, vazios e grandes demais', () => {
        expect(attachmentProblem({ name: 'a.pdf', type: 'application/pdf', size: 1000 })).toBeNull();
        expect(attachmentProblem({ name: 'a.svg', type: 'image/svg+xml', size: 10 })).toMatch(/não é permitido/);
        expect(attachmentProblem({ name: 'x.HTML', type: '', size: 10 })).toMatch(/não é permitido/);
        expect(attachmentProblem({ name: 'a.pdf', type: 'application/pdf', size: 0 })).toMatch(/vazio/);
        expect(attachmentProblem({ name: 'a.pdf', type: 'application/pdf', size: ATTACHMENT_MAX_BYTES + 1 })).toMatch(/10 MB/);
        expect(attachmentBody('QQ==', { name: 'a.bin', type: '' })).toEqual({ file: 'QQ==', filename: 'a.bin', mimeType: 'application/octet-stream', category: 'ORDER_DETAIL' });
    });

    it('só mostra a troca de status para papéis liberados', () => {
        expect(canChangeStatusManually(['HUB'], ['ADMIN', 'LINK'])).toBe(false);
        expect(canChangeStatusManually(['HUB', 'LINK'], ['LINK'])).toBe(true);
        expect(canChangeStatusManually(['ADMIN'], ['ADMIN'])).toBe(true);
        expect(canChangeStatusManually(undefined, ['ADMIN'])).toBe(false);
    });

    it('monta a troca de status com motivo e hub', () => {
        expect(statusTargets('AT_HUB').some((s) => s.id === 'AT_HUB')).toBe(false);
        expect(statusProblem({ status: '', hubId: '', reason: 'xxx' }, { isHubUser: false })).toMatch(/novo status/);
        expect(statusProblem({ status: 'AT_HUB', hubId: '', reason: 'chegou' }, { isHubUser: false })).toMatch(/hub/);
        expect(statusProblem({ status: 'AT_HUB', hubId: '', reason: 'chegou' }, { isHubUser: true })).toBeNull();
        expect(statusProblem({ status: 'DELIVERED', hubId: '', reason: ' ' }, { isHubUser: false })).toMatch(/motivo/);
        expect(statusBody({ status: 'AT_HUB', hubId: 'h1', reason: ' chegou ' }, { isHubUser: false })).toEqual({
            status: 'AT_HUB',
            currentHubId: 'h1',
            description: 'Troca manual para "No hub": chegou',
        });
        expect(statusBody({ status: 'AT_HUB', hubId: 'h1', reason: 'ok ok' }, { isHubUser: true })).not.toHaveProperty('currentHubId');
    });

    it('nota e rastreio', () => {
        expect(noteProblem(' a ')).toMatch(/mínimo/);
        expect(noteBody(' ligou ')).toEqual({ eventType: 'NOTE', description: 'ligou' });
        expect(trackingPath({ id: 'o', demandId: 'd', demand: { id: 'dm' } })).toBe('/tracking/dm');
        expect(trackingPath({ id: 'o', demandId: 'd' })).toBe('/tracking/d');
        expect(trackingUrl('https://x.com/', '/tracking/d')).toBe('https://x.com/#/tracking/d');
    });

    it('traduz erro técnico', () => {
        expect(friendlyOrderError('Order not found')).toMatch(/não encontrado/);
        expect(friendlyOrderError('Não é possível alterar o status')).toBe('Não é possível alterar o status');
    });
});
