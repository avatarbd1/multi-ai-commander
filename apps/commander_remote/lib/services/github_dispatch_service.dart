import 'dart:convert';
import 'dart:io';

class GitHubDispatchException implements Exception {
  GitHubDispatchException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => statusCode == null
      ? 'GitHubDispatchException: $message'
      : 'GitHubDispatchException($statusCode): $message';
}

class WorkflowDispatchResult {
  const WorkflowDispatchResult({
    required this.runId,
    required this.runUrl,
    required this.htmlUrl,
  });

  final int runId;
  final String runUrl;
  final String htmlUrl;
}

class GitHubDispatchService {
  GitHubDispatchService({
    this.owner = 'avatarbd1',
    this.repo = 'multi-ai-commander',
    this.workflow = 'commander-run.yml',
  });

  final String owner;
  final String repo;
  final String workflow;

  Future<WorkflowDispatchResult> dispatch({
    required String token,
    required String command,
    required String target,
    String ref = 'main',
  }) async {
    final trimmedToken = token.trim();
    final trimmedCommand = command.trim();

    if (trimmedToken.isEmpty) {
      throw GitHubDispatchException('GitHub token is required.');
    }
    if (trimmedCommand.isEmpty) {
      throw GitHubDispatchException('Command is required.');
    }

    final uri = Uri.https(
      'api.github.com',
      '/repos/$owner/$repo/actions/workflows/$workflow/dispatches',
    );

    final client = HttpClient();
    try {
      final request = await client.postUrl(uri);
      request.headers.set(HttpHeaders.acceptHeader, 'application/vnd.github+json');
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $trimmedToken');
      request.headers.set('X-GitHub-Api-Version', '2026-03-10');
      request.headers.set(HttpHeaders.userAgentHeader, 'commander-remote');
      request.headers.contentType = ContentType.json;

      request.write(jsonEncode({
        'ref': ref,
        'inputs': {
          'command': trimmedCommand,
          'target': target,
        },
      }));

      final response = await request.close();
      final responseBody = await utf8.decoder.bind(response).join();

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw GitHubDispatchException(
          responseBody.isEmpty ? 'GitHub rejected the workflow dispatch.' : responseBody,
          statusCode: response.statusCode,
        );
      }

      if (responseBody.trim().isEmpty) {
        throw GitHubDispatchException(
          'Workflow dispatch succeeded but GitHub returned no run metadata.',
          statusCode: response.statusCode,
        );
      }

      final decoded = jsonDecode(responseBody) as Map<String, dynamic>;
      final runId = decoded['workflow_run_id'];
      final runUrl = decoded['run_url'];
      final htmlUrl = decoded['html_url'];

      if (runId is! int || runUrl is! String || htmlUrl is! String) {
        throw GitHubDispatchException(
          'GitHub response did not contain the expected workflow run metadata.',
          statusCode: response.statusCode,
        );
      }

      return WorkflowDispatchResult(
        runId: runId,
        runUrl: runUrl,
        htmlUrl: htmlUrl,
      );
    } finally {
      client.close(force: true);
    }
  }
}
