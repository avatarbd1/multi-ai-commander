import 'package:flutter/material.dart';

import 'services/github_dispatch_service.dart';

void main() {
  runApp(const CommanderRemoteApp());
}

class CommanderRemoteApp extends StatelessWidget {
  const CommanderRemoteApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Commander Remote',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        useMaterial3: true,
      ),
      home: const CommanderHomePage(),
    );
  }
}

class CommanderHomePage extends StatefulWidget {
  const CommanderHomePage({super.key});

  @override
  State<CommanderHomePage> createState() => _CommanderHomePageState();
}

class _CommanderHomePageState extends State<CommanderHomePage> {
  final _tokenController = TextEditingController();
  final _commandController = TextEditingController();
  final _dispatchService = GitHubDispatchService();

  static const _targets = <String>[
    '(let planner infer)',
    'Commander',
    'Owner',
    'ClinicOS',
  ];

  String _target = _targets.first;
  bool _isRunning = false;
  String? _message;
  WorkflowDispatchResult? _lastRun;

  @override
  void dispose() {
    _tokenController.dispose();
    _commandController.dispose();
    super.dispose();
  }

  Future<void> _runCommander() async {
    setState(() {
      _isRunning = true;
      _message = null;
      _lastRun = null;
    });

    try {
      final result = await _dispatchService.dispatch(
        token: _tokenController.text,
        command: _commandController.text,
        target: _target,
      );

      if (!mounted) return;
      setState(() {
        _lastRun = result;
        _message = 'Commander Run #${result.runId} started.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _message = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() => _isRunning = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Commander Remote')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text(
              'Send one high-level command to Multi-AI Commander.',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _tokenController,
              obscureText: true,
              enableSuggestions: false,
              autocorrect: false,
              decoration: const InputDecoration(
                labelText: 'GitHub token',
                border: OutlineInputBorder(),
                helperText: 'MVP only: kept in memory and not persisted.',
              ),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              value: _target,
              items: _targets
                  .map((target) => DropdownMenuItem(
                        value: target,
                        child: Text(target),
                      ))
                  .toList(),
              onChanged: _isRunning
                  ? null
                  : (value) {
                      if (value != null) setState(() => _target = value);
                    },
              decoration: const InputDecoration(
                labelText: 'Target',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _commandController,
              minLines: 4,
              maxLines: 8,
              decoration: const InputDecoration(
                labelText: 'Command',
                hintText: 'Example: Review the current Owner app task and take it to HUMAN_GATE.',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _isRunning ? null : _runCommander,
              icon: _isRunning
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.play_arrow),
              label: Text(_isRunning ? 'Starting…' : 'Run Commander'),
            ),
            if (_message != null) ...[
              const SizedBox(height: 20),
              SelectableText(_message!),
            ],
            if (_lastRun != null) ...[
              const SizedBox(height: 12),
              SelectableText('Run URL: ${_lastRun!.htmlUrl}'),
            ],
          ],
        ),
      ),
    );
  }
}
