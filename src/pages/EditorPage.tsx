import loader from '@monaco-editor/loader';
loader.config({
  paths: {
    vs: '/vs',
  },
});

import React, { useState, useEffect } from 'react';
import { RunButton } from '../components/RunButton';
import defaultCode from '../scripts/defaultCode';
import JudgeResult from '../types/judge';
import { JudgeSuccessResult } from '../types/judge';
import { SettingsModal } from '../components/settings/SettingsModal';
import { useSettings } from '../components/SettingsContext';
import type firebaseType from 'firebase';
import { useAtom } from 'jotai';
import {
  actualUserPermissionAtom,
  currentLangAtom,
  inputMonacoEditorAtom,
  layoutEditorsAtom,
  loadingAtom,
  mainMonacoEditorAtom,
  userPermissionAtom,
} from '../atoms/workspace';
import { NavBar } from '../components/NavBar/NavBar';
import { FileMenu } from '../components/NavBar/FileMenu';
import download from '../scripts/download';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { MobileBottomNav } from '../components/NavBar/MobileBottomNav';
import { useAtomValue, useUpdateAtom } from 'jotai/utils';
import {
  fileIdAtom,
  setFirebaseErrorAtom,
  userRefAtom,
} from '../atoms/firebaseAtoms';
import { MessagePage } from '../components/MessagePage';
import { navigate, RouteComponentProps } from '@reach/router';
import firebase from 'firebase/app';
import Workspace from '../components/Workspace/Workspace';
import {
  judgeResultsAtom,
  mobileActiveTabAtom,
  showSidebarAtom,
  inputTabAtom,
  problemAtom,
  tabsListAtom,
  inputTabIndexAtom,
} from '../atoms/workspaceUI';
import { encode, cleanJudgeResult, isFirebaseId } from './editorUtils';

import { getSampleIndex } from '../components/JudgeInterface/Samples';
import { firebaseUserAtom } from '../atoms/firebaseUserAtoms';

export interface EditorPageProps extends RouteComponentProps {
  fileId?: string;
}

export default function EditorPage(props: EditorPageProps): JSX.Element {
  const [fileId, setFileId] = useAtom(fileIdAtom);
  const firebaseUser = useAtomValue(firebaseUserAtom);
  const layoutEditors = useUpdateAtom(layoutEditorsAtom);
  const mainMonacoEditor = useAtomValue(mainMonacoEditorAtom);
  const inputEditor = useAtomValue(inputMonacoEditorAtom);
  const [judgeResults, setJudgeResults] = useAtom(judgeResultsAtom);
  const [isRunning, setIsRunning] = useState(false);
  const lang = useAtomValue(currentLangAtom);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const { settings } = useSettings();
  const setUserPermission = useUpdateAtom(userPermissionAtom);
  const permission = useAtomValue(actualUserPermissionAtom);
  const loading = useAtomValue(loadingAtom);
  const setShowSidebar = useUpdateAtom(showSidebarAtom);
  const setFirebaseError = useUpdateAtom(setFirebaseErrorAtom);
  const readOnly = !(permission === 'OWNER' || permission === 'READ_WRITE');
  const isDesktop = useMediaQuery('(min-width: 1024px)', true);
  const [mobileActiveTab, setMobileActiveTab] = useAtom(mobileActiveTabAtom);
  const showSidebar = useAtomValue(showSidebarAtom);
  const problem = useAtomValue(problemAtom);

  useEffect(() => {
    const queryId: string = props.fileId ?? '';

    if (queryId === 'new') {
      setFileId({
        newId: null,
        isNewFile: true,
      });
    } else if (isFirebaseId(queryId)) {
      if (fileId?.id !== '-' + queryId) {
        setFileId({
          newId: queryId,
          isNewFile: false,
        });
      }
    } else {
      alert('Error: Bad URL');
      navigate('/', { replace: true });
    }
    // We only want to update the file ID when props.fileId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fileId]);

  useEffect(() => {
    return () => setFileId(null) as void;
  }, [setFileId]);

  const potentiallyUnauthenticatedUserRef = useAtomValue(userRefAtom);
  useEffect(() => {
    if (potentiallyUnauthenticatedUserRef) {
      const handleChange = (snap: firebaseType.database.DataSnapshot) => {
        if (!snap.exists()) return;
        const permission = snap.val().permission;
        setUserPermission(permission);
      };
      potentiallyUnauthenticatedUserRef.on('value', handleChange, e => {
        setFirebaseError(e);
      });
      return () => {
        potentiallyUnauthenticatedUserRef.off('value', handleChange);
      };
    }
  }, [potentiallyUnauthenticatedUserRef, setUserPermission, setFirebaseError]);

  const fetchJudge = (code: string, input: string): Promise<Response> => {
    const data = {
      source_code: encode(code),
      language_id: { cpp: 54, java: 62, py: 71 }[lang],
      stdin: encode(input),
      compiler_options: settings.compilerOptions[lang],
      command_line_arguments: '',
      redirect_stderr_to_stdout: false,
    };
    return fetch(
      `https://newjudge0.usaco.guide/submissions?base64_encoded=true&wait=true`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(data),
      }
    );
  };

  const [inputTab, setInputTab] = useAtom(inputTabAtom);
  const tabsList = useAtomValue(tabsListAtom);
  const inputTabIndex = useAtomValue(inputTabIndexAtom);
  useEffect(() => {
    if (inputTabIndex === tabsList.length) {
      // current tab doesn't exist
      setInputTab(tabsList[0].value);
    }
  }, [tabsList, inputTab, setInputTab, inputTabIndex]);

  const handleRunCode = () => {
    if (inputTab === 'input') {
      if (inputEditor) runWithInput(inputEditor.getValue());
    } else if (inputTab === 'judge') {
      runAllSamples();
    } else {
      const samples = problem?.samples;
      if (samples) {
        const index = getSampleIndex(inputTab);
        const sample = samples[index - 1];
        runWithInput(sample.input, sample.output, inputTab + ': ');
      }
    }
  };

  const setResultAt = (index: number, data: JudgeSuccessResult | null) => {
    const newJudgeResults = judgeResults;
    while (newJudgeResults.length <= index) newJudgeResults.push(null);
    newJudgeResults[index] = data;
    setJudgeResults(newJudgeResults);
  };
  const runWithInput = (
    input: string,
    expectedOutput?: string,
    prefix?: string
  ) => {
    if (!mainMonacoEditor || !inputEditor) {
      // editor is still loading
      return;
    }

    setIsRunning(true);
    setResultAt(inputTabIndex, null);

    const code = mainMonacoEditor.getValue();
    fetchJudge(code, input)
      .then(async resp => {
        const data: JudgeResult = await resp.json();
        if (data.error || !resp.ok) {
          alert(
            'Error: ' +
              (data.error || resp.status + ' - ' + JSON.stringify(data))
          );
        } else {
          cleanJudgeResult(data, expectedOutput, prefix);
          setResultAt(inputTabIndex, data);
        }
      })
      .catch(e => {
        console.error(e);
      })
      .finally(() => setIsRunning(false));
  };

  const runAllSamples = async () => {
    if (!problem || !mainMonacoEditor || !inputEditor) {
      // editor is still loading
      return;
    }
    const samples = problem.samples;

    setIsRunning(true);
    setResultAt(1, null);

    const code = mainMonacoEditor.getValue();
    try {
      const promises = [];
      for (let index = 0; index < samples.length; ++index) {
        const sample = samples[index];
        promises.push(fetchJudge(code, sample.input));
      }

      const newJudgeResults = judgeResults;
      const results = [];
      for (let index = 0; index < samples.length; ++index) {
        const sample = samples[index];
        const resp = await promises[index];
        const data: JudgeResult = await resp.json();
        if (data.error || !resp.ok) {
          alert(
            'Error: ' +
              (data.error || resp.status + ' - ' + JSON.stringify(data))
          );
          throw new Error('bad judge result');
        }
        let prefix = 'Sample';
        if (samples.length > 1) prefix += ` ${index + 1}`;
        prefix += ': ';
        cleanJudgeResult(data, sample.output, prefix);
        results.push(data);
        newJudgeResults[2 + index] = data;
      }
      if (samples.length > 1) {
        let verdicts = '';
        for (const result of results) {
          // https://newjudge0.usaco.guide/#statuses-and-languages-status-get
          const id = result.status.id;
          if (id === 6) {
            // compilation error
            setJudgeResults([result]);
            break;
          }
          if (id === 3) verdicts += 'A';
          else if (id === 4) verdicts += 'W';
          else if (id === 5) verdicts += 'T';
          else if (7 <= id && id <= 12) verdicts += 'R';
          else verdicts += '?';
        }
        let firstFailed = 0;
        while (
          firstFailed < samples.length - 1 &&
          verdicts[firstFailed] === 'A'
        )
          ++firstFailed;

        const failedResult = JSON.parse(JSON.stringify(results[firstFailed]));
        if (verdicts.length > 1)
          failedResult.status.description =
            'Sample Verdicts: ' +
            verdicts +
            '. ' +
            failedResult.status.description;
        newJudgeResults[1] = failedResult;
        setJudgeResults(newJudgeResults);
      } else {
        newJudgeResults[1] = newJudgeResults[2];
      }
    } catch (e) {
      console.error(e);
    }
    setIsRunning(false);
  };

  const handleToggleSidebar = () => {
    setShowSidebar(show => !show);
    setTimeout(() => {
      layoutEditors();
    }, 0);
  };

  const handleDownloadFile = () => {
    if (!mainMonacoEditor) {
      alert("Editor hasn't loaded yet. Please wait.");
      return;
    }

    const fileNames = {
      cpp: 'main.cpp',
      java: 'Main.java',
      py: 'main.py',
    };

    download(fileNames[lang], mainMonacoEditor.getValue());
  };

  const handleInsertFileTemplate = () => {
    if (!mainMonacoEditor) {
      alert("Editor hasn't loaded yet, please wait");
      return;
    }
    if (confirm('Reset current file? Any changes you made will be lost.')) {
      mainMonacoEditor.setValue(defaultCode[lang]);
    }
  };

  useEffect(() => {
    document.title = `${
      settings.workspaceName ? settings.workspaceName + ' · ' : ''
    }Real-Time Collaborative Online IDE`;
  }, [settings.workspaceName]);

  useEffect(() => {
    if (permission === null) return;
    if (firebaseUser && fileId?.id) {
      const fileRef = firebase
        .database()
        .ref('users')
        .child(firebaseUser.uid)
        .child(fileId.id);
      if (permission === 'PRIVATE') {
        // remove from dashboard recently accessed files
        fileRef.remove();
      } else {
        fileRef.set({
          title: settings.workspaceName || '',
          lastAccessTime: firebase.database.ServerValue.TIMESTAMP,
          creationTime: settings.creationTime ?? null,
          lastPermission: permission,
          lastDefaultPermission: settings.defaultPermission,
          hidden: false,
        });
      }
    }
  }, [
    firebaseUser,
    fileId,
    permission,
    settings.workspaceName,
    settings.creationTime,
    settings.defaultPermission,
  ]);

  /*This method keeps getting called multiple times (~100) per Ctrl+s press
   * When I try creating a similar `document.addEventListener("keydown"...` method in somewhere with a higher scope, it still repeats itself, but does it fewer times
   * (i.e. putting the method in src\App.tsx only repeats it 4 times)
   * The only way I was able to get the code to run only a single time was to open up the Web Console and define the function there
   ** (though it could not invoke the download method from the TypeScript code when defined in this manner)
   * After half a day of trying to debug it (it's prob someting to do with scope based on above),
   * I'm just going to stop trying to implement the `save` feature and just leave it at only suppressing Ctrl+s (similar to what repl.it does)
   * End rant; if someone who is more competent at WebDev than me knows what the issue is here, a fix would be greatly appreciated!
   */
  document.addEventListener(
    'keydown',
    function (e) {
      if (
        e.key == 's' &&
        (navigator.platform.match('Mac') ? e.metaKey : e.ctrlKey)
      ) {
        e.preventDefault(); //Prevents the default "Save as HTML"
        //handleDownloadFile();
        return;
      }
    },
    false
  );

  if (permission === 'PRIVATE')
    return <MessagePage message="This file is private." />;

  // https://reactjs.org/docs/concurrent-mode-suspense.html#what-is-suspense-exactly
  return (
    <div className="h-full">
      <div className="h-full flex flex-col">
        <div className="flex-shrink-0 bg-[#1E1E1E]">
          <NavBar
            fileMenu={
              <FileMenu
                onDownloadFile={handleDownloadFile}
                onInsertFileTemplate={handleInsertFileTemplate}
                onOpenSettings={() => setIsSettingsModalOpen(true)}
                forkButtonUrl={`/${fileId?.id?.substring(1)}/copy`}
              />
            }
            runButton={
              <RunButton
                onClick={handleRunCode}
                showLoading={isRunning || loading}
              />
            }
            showViewOnly={!loading && readOnly}
            isSidebarOpen={showSidebar}
            onToggleSidebar={handleToggleSidebar}
            showSidebarButton={isDesktop}
          />
        </div>
        <div className="flex-1 min-h-0">
          <Workspace handleRunCode={handleRunCode} tabsList={tabsList} />
        </div>
        {!isDesktop && (
          <MobileBottomNav
            activeTab={mobileActiveTab}
            onActiveTabChange={setMobileActiveTab}
          />
        )}
      </div>

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />
    </div>
  );
}
