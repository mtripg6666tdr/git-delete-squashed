#!/usr/bin/env node

'use strict';

const childProcess = require('child_process');
const fs = require('fs');

const Promise = require('bluebird');
const selectedBranchName = determineBranchName();

/**
 * Determines default branch from args, environment variables, a config file
 * @returns {string} default branch name
 */
function determineBranchName () {
  const DEFAULT_BRANCH_NAME = 'master';
  const RUN_WITH_NODE = process.argv[0].includes('node');
  const configBranchName = (function () {
    try {
      const config = fs.existsSync('.gds')
        ? fs.readFileSync('.gds', { encoding: 'utf-8' })
        : fs.existsSync('.git-delete-squashed')
          ? fs.readFileSync('.git-delete-squashed', { encoding: 'utf-8' })
          : null
      ;
      return JSON.parse(config).defaultBranch;
    } catch (e) {
      return null;
    }
  }());
  return process.argv[RUN_WITH_NODE ? 2 : 1] || process.env.DEFAULT_BRANCH_NAME || configBranchName || DEFAULT_BRANCH_NAME;
}

/**
 * Calls `git` with the given arguments from the CWD
 * @param {string[]} args A list of arguments
 * @returns {Promise<string>} The output from `git`
 */
function git (args) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn('git', args);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => stdout += data);
    child.stderr.on('data', data => stderr += data);

    child.on('close', exitCode => exitCode ? reject(stderr) : resolve(stdout));
  }).then(stdout => stdout.replace(/\n$/, ''));
}

git(['for-each-ref', 'refs/heads/', '--format=%(refname:short)'])
  .then(branchListOutput => branchListOutput.split('\n'))
  .tap(branchNames => {
    if (!branchNames.includes(selectedBranchName)) {
      throw `fatal: no branch named '${selectedBranchName}' found in this repo`;
    }
  }).filter(branchName =>
    // Get the common ancestor with the branch and master
    Promise.join(
      git(['merge-base', selectedBranchName, branchName]),
      git(['rev-parse', `${branchName}^{tree}`]),
      (ancestorHash, treeId) => git(['commit-tree', treeId, '-p', ancestorHash, '-m', `Temp commit for ${branchName}`]),
    )
      .then(danglingCommitId => git(['cherry', selectedBranchName, danglingCommitId]))
      .then(output => output.startsWith('-')),
  )
  .tap(branchNamesToDelete => branchNamesToDelete.length && git(['checkout', selectedBranchName]))
  .mapSeries(branchName => git(['branch', '-D', branchName]))
  .mapSeries(stdout => console.log(stdout))
  .catch(err => console.error(err.cause || err));
