import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../logger';
import { doRedteamRun } from '../../redteam/commands/run';
import { evalJobs } from './eval';

export const redteamRouter = Router();

const CLOUD_FUNCTION_URL =
  process.env.PROMPTFOO_REMOTE_GENERATION_URL || 'https://api.promptfoo.dev/v1/generate';

redteamRouter.post('/run', async (req: Request, res: Response): Promise<void> => {
  const config = req.body;
  const id = uuidv4();

  // Initialize job status
  evalJobs.set(id, { status: 'in-progress', progress: 0, total: 0, result: null });

  // Run redteam in background
  doRedteamRun({
    liveRedteamConfig: config,
    /*
    progressCallback: (progress: number, total: number) => {
      const job = evalJobs.get(id);
      if (job) {
        job.progress = progress;
        job.total = total;
      }
    },
    */
  })
    .then(() => {
      const job = evalJobs.get(id);
      if (job) {
        job.status = 'complete';
      }
    })
    .catch((error) => {
      console.error('Error running redteam:', error);
      const job = evalJobs.get(id);
      if (job) {
        job.status = 'error';
      }
    });

  res.json({ id });
});

// NOTE: This comes last, so the other routes take precedence
redteamRouter.post('/:task', async (req: Request, res: Response): Promise<void> => {
  const { task } = req.params;

  logger.debug(`Received ${task} task request:`, {
    method: req.method,
    url: req.url,
    body: req.body,
  });

  try {
    logger.debug(`Sending request to cloud function: ${CLOUD_FUNCTION_URL}`);
    const response = await fetch(CLOUD_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task,
        ...req.body,
      }),
    });

    if (!response.ok) {
      logger.error(`Cloud function responded with status ${response.status}`);
      throw new Error(`Cloud function responded with status ${response.status}`);
    }

    const data = await response.json();
    logger.debug(`Received response from cloud function:`, data);
    res.json(data);
  } catch (error) {
    logger.error(`Error in ${task} task:`, error);
    res.status(500).json({ error: `Failed to process ${task} task` });
  }
});
