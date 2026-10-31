import { useRef, useState } from 'react';
import { Modal } from '@mantine/core';
import { Camera, FolderOpen, Upload, ScanLine } from 'lucide-react';
import type { Ticket } from '../../shared/types';
import { useStation } from '../context';
import { patch, post } from '../lib/api';
import { usePageSize, useTask } from '../lib/hooks';
import { useCurrentTicket } from '../lib/ticket';
import { useUploads } from '../lib/uploads';
import { useWatcher } from '../lib/watcher';
import { StationLayout } from '../components/StationLayout';
import { Scanner } from '../components/Scanner';
import { PhotoGrid } from '../components/PhotoGrid';
import { Button, Empty, Notice } from '../components/Ui';

export default function Photography() {
  const { event, prefs, updatePrefs } = useStation(),
    { ticket, setTicket, loadError } = useCurrentTicket(),
    task = useTask(),
    [finish, setFinish] = useState(false),
    input = useRef<HTMLInputElement>(null);
  const uploads = useUploads(event.id, ticket?.id, setTicket),
    watcher = useWatcher(event.id, ticket, uploads.add),
    pageSize = usePageSize(prefs.thumbnailSize === 'large');
  const active = ticket?.status === 'photographing';
  async function lookup(identifier: string) {
    await task.run(async () => {
      let result = await post<Ticket>('/tickets/lookup', { identifier });
      if (result.status === 'registered')
        result = await post<Ticket>(`/tickets/${result.id}/start`);
      setTicket(result);
    });
  }
  async function complete() {
    const result = await task.run(async () => {
      await watcher.finalScan();
      await uploads.waitUntilIdle();
      await post(`/tickets/${ticket!.id}/finish`);
      setFinish(false);
      setTicket(null);
    });
    if (result === undefined) watcher.resume();
  }
  const settingsExtra = (
    <div className="settings-group">
      <strong>Automatic ingestion</strong>
      <p className="field-hint">
        {watcher.connected
          ? `Watching ${watcher.folderName}`
          : watcher.supported
            ? 'Connect a folder before photographing the next customer.'
            : 'Use Chrome for folder monitoring, or upload manually.'}
      </p>
      <Button onClick={() => void task.run(watcher.connect)}>
        <FolderOpen size={18} />
        {watcher.connected ? 'Reconnect folder' : 'Choose export folder'}
      </Button>
      {watcher.connected ? (
        <Button onClick={() => void task.run(watcher.replace)}>Choose another folder</Button>
      ) : null}
    </div>
  );
  return (
    <StationLayout
      ticket={ticket}
      settingsExtra={settingsExtra}
      back={
        active && ticket?.photos.length === 0
          ? {
              label: 'Scan another',
              blocked: task.busy,
              disabled: !!uploads.items.length,
              onClick: () => setTicket(null),
            }
          : undefined
      }
      error={loadError}
      status={
        uploads.items.length
          ? `Uploading ${uploads.items.length} photo${uploads.items.length === 1 ? '' : 's'}`
          : watcher.connected
            ? watcher.paused
              ? 'Folder paused'
              : 'Folder connected'
            : undefined
      }
      action={
        ticket
          ? active
            ? {
                label: 'Finish customer',
                onClick: () => setFinish(true),
                blocked: task.busy,
                disabled:
                  uploads.items.some((item) => item.state === 'failed') ||
                  (!ticket.photos.some((p) => !p.excludedPhotography) && !uploads.items.length),
              }
            : { label: 'Next customer', onClick: () => setTicket(null) }
          : undefined
      }
    >
      {!ticket ? (
        <>
          <Scanner onLookup={(value) => void lookup(value)} busy={task.busy} error={task.error} />
          <div className="idle-folder">
            <Button className="quiet" onClick={() => void task.run(watcher.connect)}>
              <FolderOpen size={17} />
              {watcher.connected ? watcher.folderName : 'Connect export folder'}
            </Button>
          </div>
        </>
      ) : !active ? (
        <Empty icon={<Camera size={44} />} title="Photography is complete">
          <p>
            This ticket is{' '}
            {ticket.status === 'submitted' ? 'already submitted' : 'ready for selection'}. Start the
            next customer above.
          </p>
        </Empty>
      ) : (
        <div
          className="capture-workspace"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void uploads.add(Array.from(e.dataTransfer.files));
          }}
        >
          <div className="workspace-toolbar">
            <div>
              <h1>Capture the moment.</h1>
              <span>
                {ticket.photos.filter((p) => !p.excludedPhotography).length} included
                {watcher.connected ? ` · ${watcher.folderName}` : ''}
              </span>
            </div>
            <div className="toolbar-actions">
              <Button
                aria-label="Highlight zebras"
                aria-pressed={prefs.highlightZebras}
                className={prefs.highlightZebras ? 'selected-control' : ''}
                title="Highlight warning: JPEG brightness ≥98%. Originals unchanged."
                onClick={() => updatePrefs({ highlightZebras: !prefs.highlightZebras })}
              >
                <ScanLine size={18} /> Zebras
              </Button>
              <Button onClick={() => input.current?.click()}>
                <Upload size={18} />
                Upload JPEGs
              </Button>
            </div>
            <input
              ref={input}
              type="file"
              accept="image/jpeg,.jpg,.jpeg"
              multiple
              hidden
              onChange={(e) => {
                void uploads.add(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </div>
          <Notice>{task.error || watcher.error}</Notice>
          {ticket.photos.length || uploads.items.length ? (
            <PhotoGrid
              key={ticket.id}
              photos={ticket.photos}
              mode="photography"
              pageSize={pageSize}
              pending={task.busy}
              zebra={prefs.highlightZebras}
              onZebra={() => updatePrefs({ highlightZebras: !prefs.highlightZebras })}
              uploads={uploads.items}
              onRetryUpload={uploads.retry}
              onDiscardUpload={(id) => void uploads.discard(id)}
              onExclude={(photo) =>
                void task.run(async () =>
                  setTicket(
                    await patch<Ticket>(`/photos/${photo.id}`, {
                      excludedPhotography: !photo.excludedPhotography,
                    }),
                  ),
                )
              }
            />
          ) : (
            <Empty icon={<Upload size={45} />} title="Your photos will appear here">
              <p>
                Drop JPEGs anywhere in this workspace
                {watcher.connected
                  ? ' or export them to the connected folder'
                  : ', or use Upload JPEGs'}
                .
              </p>
            </Empty>
          )}
        </div>
      )}
      <Modal
        opened={finish}
        onClose={() => {
          if (!task.busy) setFinish(false);
        }}
        title="Finish photography"
        centered
        closeOnClickOutside={!task.busy}
        closeOnEscape={!task.busy}
      >
        <p>
          Finish all camera and Lightroom exports before continuing. FrameRelay will check the
          folder and wait for detected uploads.
        </p>
        <Notice>{task.error}</Notice>
        <div className="modal-actions">
          <Button onClick={() => setFinish(false)} disabled={task.busy}>
            Back
          </Button>
          <Button primary busy={task.busy} onClick={() => void complete()}>
            Exports finished — continue
          </Button>
        </div>
      </Modal>
    </StationLayout>
  );
}
