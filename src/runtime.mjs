import {collectGithubReadEvidence} from './github-read-adapter.mjs';
import {collectGitDiff,preparePublicGitStore} from './git-diff.mjs';
import {buildReceipt,validateTarget} from './receipt.mjs';

// Hold the final provider snapshot until diff collection is finished. No PR code is executed.
export async function runTrustPr(target,{client,gitDirectory,source='GITHUB_READONLY'}){
  validateTarget(target);
  if(!client||typeof client.getPullRequest!=='function')throw Object.assign(new Error('CLIENT_INVALID'),{code:'CLIENT_INVALID'});
  let firstSnapshot=null,diff=null,store=null;
  const wrapped=Object.create(client);
  wrapped.getPullRequest=async args=>{
    const snapshot=await client.getPullRequest(args);
    if(firstSnapshot===null){
      firstSnapshot=snapshot;
      const base=snapshot.base_commit_sha,head=snapshot.head_commit_sha;
      if(!/^[0-9a-f]{40}$/.test(base??'')||!/^[0-9a-f]{40}$/.test(head??''))return snapshot;
      if((target.expectedBaseSha&&base!==target.expectedBaseSha)||(target.expectedHeadSha&&head!==target.expectedHeadSha))return snapshot;
      try{
        if(!gitDirectory){store=await preparePublicGitStore({owner:target.owner,repo:target.repo,baseSha:base,headSha:head});gitDirectory=store.gitDirectory;}
        diff=await collectGitDiff({gitDirectory,baseSha:base,headSha:head});
      }catch{
        diff={status:'PARTIAL',base_commit_sha:base,head_commit_sha:head,merge_base_sha:'',changed_entries:[],
          unknowns:[{stable_code:'PUBLIC_GIT_OBJECTS_UNAVAILABLE',field_or_source_tuple:'git_diff'}]};
      }
    }
    return snapshot;
  };
  try{
    const evidence=await collectGithubReadEvidence(wrapped,target);
    if(!diff)diff={status:'PARTIAL',base_commit_sha:evidence.s0?.base_commit_sha??target.expectedBaseSha??'',
      head_commit_sha:evidence.s0?.head_commit_sha??target.expectedHeadSha??'',merge_base_sha:'',changed_entries:[],
      unknowns:[{stable_code:'GIT_DIFF_NOT_COLLECTED',field_or_source_tuple:'git_diff'}]};
    return buildReceipt({target,evidence,diff,source});
  }finally{await store?.cleanup();}
}
