/*
 * Windletter playtime watcher.
 *
 * Usage: playtime-watch.exe <game-pid> <completion-file>
 *
 * Waits for the game process to exit, then writes the Unix epoch in
 * milliseconds to the completion file. The launcher imports this timestamp
 * on its next start, so closing the launcher no longer stops the clock.
 *
 * Build (x64, MinGW-w64):
 *   x86_64-w64-mingw32-gcc -O2 -s -municode -o playtime-watch.exe playtime-watch.c
 */
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

int wmain(int argc, wchar_t **argv) {
  if (argc < 3) return 2;
  DWORD pid = (DWORD)wcstoul(argv[1], NULL, 10);
  const wchar_t *done = argv[2];

  HANDLE process = OpenProcess(SYNCHRONIZE, FALSE, pid);
  if (process) {
    WaitForSingleObject(process, INFINITE);
    CloseHandle(process);
  }

  FILETIME fileTime;
  GetSystemTimeAsFileTime(&fileTime);
  ULONGLONG ticks = ((ULONGLONG)fileTime.dwHighDateTime << 32) | fileTime.dwLowDateTime;
  ULONGLONG unixMs = (ticks - 116444736000000000ULL) / 10000ULL;

  size_t length = wcslen(done);
  wchar_t *tmp = (wchar_t *)malloc((length + 5) * sizeof(wchar_t));
  if (!tmp) return 3;
  wcscpy(tmp, done);
  wcscat(tmp, L".tmp");

  FILE *file = _wfopen(tmp, L"wb");
  if (!file) {
    free(tmp);
    return 4;
  }
  fprintf(file, "%llu", unixMs);
  fclose(file);
  MoveFileExW(tmp, done, MOVEFILE_REPLACE_EXISTING);
  free(tmp);
  return 0;
}
