$(function () {

  function getUriTemplatesFromSettings() {
    return JSON.parse(this.settings.uri_templates);
  };

  _.memoize(function fieldsToWatch() {
    return _.reduce(getUriTemplatesFromSettings(), function (memo, uri) {
      let fields = _.map(uri.url.match(/\{\{(.+?)\}\}/g), function (f) { return f.slice(2, -2); });

      return _.union(memo, fields);
    }, []);
  });

  // helper function that creates our request
  function fetchUsers(ids) {
    return {
      url: helpers.fmt('/api/v2/users/show_many.json?ids=%@&include=organizations,groups', ids.join(',')),
      type: 'GET',
      dataType: 'json'
    };
  };

  function decorateUser(user) {
    let name = (user.name || '').split(' ');

    user.firstname = name[0] || '';
    user.lastname = name[1] || '';

    return user;
  };

  function findUserById(users, user_id) {
    return _.find(users, function (user) {
      return user.id == user_id;
    }, this);
  };

  function getContext(data) {
    var context = _.clone(this.containerContext());

    if (context.ticket.requester.id) {
      context.ticket.requester = decorateUser(findUserById(data.users, context.ticket.requester.id));

      if (context.ticket.requester.organization_id) {
        context.ticket.organization = _.find(data.organizations, function (org) {
          return org.id == context.ticket.requester.organization_id;
        });
      }
    }

    if (context.ticket.assignee.user.id) {
      context.ticket.assignee.user = decorateUser(findUserById(data.users, context.ticket.assignee.user.id));
    };

    //copying data not available on this.containerContext()
    let currentUserId = null;

    client.get('ticket.id').then(data => {
      context.ticket.id = data;
      return client.get('ticket.description');
    }).then(data => {
      context.ticket.description = data;
      return client.get('current_user');
    }).then(data => {
      currentUserId = data.id;
      context.current_user = decorateUser(findUserById(data.users, currentUserId));
      return context;
    }), (error => {
      log.error("An error occurred getting context data: ", error);
    });
  };

  function onFetchUsersDone(data) {
    let templateUris = getUriTemplatesFromSettings(),
      templateOptions = { interpolate: /\{\{(.+?)\}\}/g },
      context = getContext(data),
      uris = _.map(templateUris, function (uri) {
        try {
          uri.url = _.template(uri.url, templateOptions)(context);
          uri.title = _.template(uri.title, templateOptions)(context);
        } catch (e) {
          services.notify(e, 'error');
        }
        return uri;
      }, this);

    this.switchTo('list', { uris: uris });
  };

  function onAppCreated() {
    let assigneeId = null;
    let requesterId = null;
    let userId = null;

    client.get('ticket.assignee.user').then(data => {
      assigneeId = data.id;
      return client.get('ticket.requester');
    }).then(data => {
      requesterId = data.id;      
      return client.get('current_user');
    }).then(data => {
      userId = data.id;
    }).catch(error => {
      log.error("Error retrieving ids: ", error);
    });

    let userIds = _.compact(_.uniq([assigneeId, userId, requesterId]));
    let settings = fetchUsers(userIds);

    client.request(settings).then(data => {
      onFetchUsersDone(data);
    });
  };

  // Initialise the Zendesk JavaScript API client
  // https://developer.zendesk.com/apps/docs/apps-v2
  var client = ZAFClient.init();

  client.on('instance.created', function () {
    onAppCreated()
  });

  client.on('*.changed', function (e) {
    if (_.contains(fieldsToWatch(), e.propertyName))
      return onAppCreated();
  });

  client.on('fetchUsers.done', function () {
    onFetchUsersDone()
  });
});