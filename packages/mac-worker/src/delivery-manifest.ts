import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { deliveryManifestSchema, type DeliveryManifest } from '@jdcv/contracts';
import type { ExportApproval } from '@jdcv/cv-render';
import { approvedCv, type CvProposal } from './cv-proposal.js';

const manifestName = 'delivery-manifest.json';
const files = { docx: 'approved.docx', pdf: 'approved.pdf' } as const;

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function privateDirectory(
  directory: string,
  create: boolean,
): Promise<string> {
  if (!isAbsolute(directory))
    throw new Error('Result directory must be absolute');
  const absolute = resolve(directory);
  if (create) await mkdir(absolute, { recursive: true, mode: 0o700 });
  const entry = await lstat(absolute);
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    (entry.mode & 0o077) !== 0
  )
    throw new Error('Result directory is not private');
  return absolute;
}

function validateApproval(manifest: DeliveryManifest): void {
  if (
    manifest.approval.cvVersionId !== manifest.cvVersionId ||
    manifest.approval.approvedVersionId !== manifest.cvVersionId ||
    manifest.approval.embellishments.length !== manifest.diff.length
  )
    throw new Error('Approval does not match CV version or diff');
  const entries = new Map(
    manifest.approval.embellishments.map((entry) => [entry.id, entry]),
  );
  if (entries.size !== manifest.diff.length)
    throw new Error('Duplicate approval entry');
  const paths = new Set<string>();
  const ids = new Set<string>();
  for (const line of manifest.diff) {
    const entry = entries.get(line.id);
    if (
      ids.has(line.id) ||
      paths.has(line.path) ||
      !entry ||
      entry.status !== line.decision ||
      entry.lineApproved !== (line.decision === 'approved') ||
      entry.criticalFindings !== line.criticalFindings ||
      entry.defenseEntryId !==
        (line.decision === 'approved' ? line.defenseEntryId : null) ||
      entry.defenseScore !==
        (line.decision === 'approved' ? line.defenseScore : null) ||
      (line.decision === 'approved' &&
        (line.defenseScore === null ||
          line.defenseScore < 4 ||
          line.criticalFindings !== 0))
    )
      throw new Error('Unresolved or inconsistent CV decision');
    paths.add(line.path);
    ids.add(line.id);
  }
}

async function readPrivateFile(
  directory: string,
  fileName: string,
): Promise<Buffer> {
  const path = join(directory, fileName);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const entry = await handle.stat();
    if (!entry.isFile() || (entry.mode & 0o077) !== 0 || entry.nlink !== 1)
      throw new Error('Result file is not a private regular file');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function readDeliveryManifest(
  resultDir: string,
): Promise<DeliveryManifest> {
  const directory = await privateDirectory(resultDir, false);
  const manifest = deliveryManifestSchema.parse(
    JSON.parse(
      (await readPrivateFile(directory, manifestName)).toString('utf8'),
    ),
  );
  validateApproval(manifest);
  for (const format of ['docx', 'pdf'] as const) {
    const record = manifest[format];
    const bytes = await readPrivateFile(directory, record.fileName);
    if (bytes.length !== record.size || digest(bytes) !== record.sha256)
      throw new Error('Result file size or digest mismatch');
  }
  return manifest;
}

export async function writeDeliveryManifest(options: {
  resultDir: string;
  jobId: string;
  ownerId: string;
  proposal: CvProposal;
  exported: { docx: Buffer; pdf: Buffer; approval: ExportApproval };
  createdAt?: string;
}): Promise<DeliveryManifest> {
  const { approval } = approvedCv(options.proposal);
  if (JSON.stringify(approval) !== JSON.stringify(options.exported.approval))
    throw new Error('Export approval does not match resolved proposal');
  for (const format of ['docx', 'pdf'] as const)
    if (
      !Buffer.isBuffer(options.exported[format]) ||
      !options.exported[format].length
    )
      throw new Error('Approved export bytes are missing');
  const manifest = deliveryManifestSchema.parse({
    version: 1,
    jobId: options.jobId,
    cvVersionId: options.proposal.cvVersionId,
    ownerId: options.ownerId,
    createdAt: options.createdAt ?? new Date().toISOString(),
    diff: options.proposal.lines.map(
      ({
        id,
        path,
        before,
        after,
        reason,
        requirementId,
        sourceRef,
        risk,
        riskNote,
        interviewAnswer,
        defenseEntryId,
        change,
        embellishment,
        decision,
        defenseScore,
        criticalFindings,
      }) => ({
        id,
        path,
        before,
        after,
        reason,
        requirementId,
        sourceRef,
        risk,
        riskNote,
        interviewAnswer,
        defenseEntryId,
        change,
        embellishment,
        decision,
        defenseScore,
        criticalFindings,
      }),
    ),
    approval,
    docx: {
      fileName: files.docx,
      size: options.exported.docx.length,
      sha256: digest(options.exported.docx),
    },
    pdf: {
      fileName: files.pdf,
      size: options.exported.pdf.length,
      sha256: digest(options.exported.pdf),
    },
  });
  validateApproval(manifest);
  const directory = await privateDirectory(options.resultDir, true);
  if (
    await lstat(join(directory, manifestName)).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return false;
      },
    )
  )
    throw new Error('Manifest already exists');
  const created: string[] = [];
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    for (const format of ['docx', 'pdf'] as const) {
      const path = join(directory, files[format]);
      const handle = await open(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      created.push(path);
      try {
        await handle.writeFile(options.exported[format]);
      } finally {
        await handle.close();
      }
      await chmod(path, 0o600);
    }
    for (const format of ['docx', 'pdf'] as const) {
      const bytes = await readPrivateFile(directory, files[format]);
      if (
        bytes.length !== manifest[format].size ||
        digest(bytes) !== manifest[format].sha256
      )
        throw new Error('Written export differs from approved bytes');
    }
    const existing = await lstat(join(directory, manifestName)).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return false;
      },
    );
    if (existing) throw new Error('Manifest already exists');
    const handle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(JSON.stringify(manifest));
    } finally {
      await handle.close();
    }
    await rename(temporary, join(directory, manifestName));
    return manifest;
  } catch (error) {
    await Promise.all(
      created.map((path) => unlink(path).catch(() => undefined)),
    );
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
